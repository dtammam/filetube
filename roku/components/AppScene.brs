sub init()
    m.top.backgroundUri = ""
    m.top.backgroundColor = "0x141414FF"

    m.statusLabel = m.top.FindNode("statusLabel")
    m.loginScreen = m.top.FindNode("loginScreen")
    m.gridScreen = m.top.FindNode("gridScreen")
    m.video = m.top.FindNode("videoPlayer")
    m.audioOverlay = m.top.FindNode("audioOverlay")
    m.audioBackdrop = m.top.FindNode("audioBackdrop")
    m.audioArt = m.top.FindNode("audioArt")
    m.audioTitle = m.top.FindNode("audioTitle")
    m.playbackMenuGroup = m.top.FindNode("playbackMenuGroup")
    m.playbackMenuTitle = m.top.FindNode("playbackMenuTitle")
    m.playbackMenu = m.top.FindNode("playbackMenu")
    m.playbackMenu.ObserveField("itemSelected", "onPlaybackMenuSelected")
    m.progressTimer = m.top.FindNode("progressTimer")
    m.progressTimer.ObserveField("fire", "onProgressTick")
    m.prewarmedForId = "" ' one prewarm per played item, never a cascade
    ' v1.47.2: in-session progress overlay, id -> seconds. Kept HERE and never
    ' written onto the item's ContentNode -- see progressFor().
    m.sessionProgress = {}
    m.resumeDialog = invalid

    m.pendingSeekPos = invalid
    m.playingExt = ""
    m.playingCodecs = ""
    m.gating = false

    ' v1.47 playback state: the queue is the grid's own ContentNode (it keeps
    ' growing as pages load), plus persisted loop/autoplay preferences.
    m.queue = invalid
    m.queueIndex = -1
    m.currentItem = invalid
    m.chapters = []
    m.chaptersItemId = ""
    m.menuMode = "main"
    m.menuActions = []

    m.loginScreen.ObserveField("credentials", "onCredentials")
    m.gridScreen.ObserveField("selectedItem", "onItemSelected")
    m.gridScreen.ObserveField("loadError", "onGridLoadError")
    m.gridScreen.ObserveField("authExpired", "onAuthExpired")
    m.video.ObserveField("state", "onVideoState")

    m.state = FT_RegistryRead()
    m.loopMode = "off"
    if m.state.loopmode = "this" or m.state.loopmode = "all" then m.loopMode = m.state.loopmode
    m.autoplay = (m.state.autoplay = "1")

    if m.state.serverUrl <> "" and m.state.cookie <> ""
        showStatus("Connecting to FileTube…")
        runAuth("validate")
    else
        showLogin()
    end if
end sub

' ---- auth -----------------------------------------------------------------

sub runAuth(mode as string)
    m.authMode = mode
    m.authTask = CreateObject("roSGNode", "AuthTask")
    m.authTask.mode = mode
    m.authTask.serverUrl = m.state.serverUrl
    if mode = "login"
        m.authTask.username = m.state.username
        m.authTask.password = m.pendingPassword
    else
        m.authTask.cookie = m.state.cookie
    end if
    m.authTask.ObserveField("result", "onAuthResult")
    m.authTask.control = "RUN"
end sub

sub onCredentials()
    creds = m.loginScreen.credentials
    if creds = invalid then return
    m.state.serverUrl = creds.serverUrl
    m.state.username = creds.username
    m.pendingPassword = creds.password
    m.loginScreen.visible = false
    showStatus("Signing in…")
    runAuth("login")
end sub

sub onAuthResult()
    result = m.authTask.result
    if result = invalid then return
    m.pendingPassword = ""

    if result.ok = true
        if m.authMode = "login"
            m.state.cookie = result.cookie
            FT_RegistryWrite({ serverUrl: m.state.serverUrl, username: m.state.username, cookie: m.state.cookie })
        end if
        enterLibrary()
        return
    end if

    ' Validate failed: expired/revoked session goes quietly back to login;
    ' anything else (server down, DNS) gets an explanation first.
    if m.authMode = "validate" and result.code <> invalid and result.code = 401
        FT_RegistryClearSession()
        m.state.cookie = ""
        showLogin()
        return
    end if
    showLogin()
    showDialog("Sign-in problem", result.error)
end sub

sub enterLibrary()
    ' One header at scene level: Poster thumbnails and the Video node inherit
    ' the nearest ancestor's HttpAgent, so every request carries the session.
    ' SetHeaders (not AddHeader) so an in-app re-login REPLACES the cookie
    ' instead of stacking a second Cookie header on the same agent.
    m.top.SetHeaders({ Cookie: m.state.cookie })
    m.video.SetHeaders({ Cookie: m.state.cookie })

    ' Session-local progress is PER SIGNED-IN USER: a re-login (possibly as
    ' someone else on the same TV) must not inherit the previous account's
    ' positions, which progressFor would prefer over the server's own and
    ' the next ping would then persist onto the new account.
    m.sessionProgress = {}

    m.statusLabel.visible = false
    m.loginScreen.visible = false
    m.gridScreen.serverUrl = m.state.serverUrl
    m.gridScreen.cookie = m.state.cookie
    m.gridScreen.visible = true
    m.gridScreen.begin = true
end sub

' ---- library --------------------------------------------------------------

sub onGridLoadError()
    if m.gridScreen.loadError = "" then return
    showDialog("Library error", m.gridScreen.loadError)
end sub

sub onAuthExpired()
    if not m.gridScreen.authExpired then return
    ' Gate W4 (v1.46): a stale task's 401 can land while a playback gate is
    ' mid-poll; a later gate success must not start playback OVER the login
    ' screen with a dead cookie.
    if m.gating then cancelPlaybackGate()
    ' Gate C2 (v1.47): the ensureLoaded prefetch means a 401 can now land
    ' MID-PLAYBACK -- tear the playback surface down too, or live video
    ' keeps playing over the login screen with a dead cookie.
    if m.playbackMenuGroup.visible then closePlaybackMenu()
    stopPlaybackSurface()
    m.pendingContent = invalid
    FT_RegistryClearSession()
    m.state.cookie = ""
    m.gridScreen.visible = false
    showLogin()
    showDialog("Signed out", "Your session expired. Please sign in again.")
end sub

' ---- selection, resume prompt, queue --------------------------------------

sub onItemSelected()
    ' Gate W4 (v1.46): the grid is hidden but still FOCUSED while
    ' "Preparing…" shows, so a second OK press would re-enter here.
    if m.gating then return
    ' v1.47.2: a selection can ONLY be a real OK press while the grid is on
    ' screen. Anything arriving during playback (or while the resume dialog
    ' is up) is a spurious re-fire, and acting on it restarted the video
    ' mid-watch. Ignore by construction, whatever the source.
    if m.video.visible or m.resumeDialog <> invalid then return
    item = m.gridScreen.selectedItem
    if item = invalid or item.ftId = "" then return
    ' Capture the queue + index the grid set just before selectedItem fired.
    m.queue = m.gridScreen.queue
    playIndex(m.gridScreen.selectedIndex, true, false)
end sub

' Start (or advance to) queue position i. Returns true when playback (or its
' resume prompt) actually started -- advanceAfterFinish uses the false case
' to land on the grid instead of a dead frame (gate S6).
'   allowPrompt: explicit user selection -> offer Resume/Start over.
'   fromStart:   loop replays -> never auto-resume (a near-end resume
'                would re-finish instantly and spin the loop).
function playIndex(index as integer, allowPrompt as boolean, fromStart as boolean) as boolean
    if m.queue = invalid then return false
    if index < 0 or index >= m.queue.GetChildCount() then return false
    item = m.queue.GetChild(index)
    if item = invalid or item.ftId = "" then return false
    m.queueIndex = index
    m.currentItem = item

    resumePos = invalid
    savedPos = progressFor(item)
    if not fromStart and savedPos >= 30
        if item.ftDuration <= 0 or savedPos < 0.95 * item.ftDuration
            resumePos = savedPos
        end if
    end if

    ' The prompt belongs to STARTING something. It cannot re-appear during
    ' playback because onItemSelected refuses selections while the video is
    ' on screen -- a per-item "asked already" flag would add nothing here and
    ' would silently auto-resume an item whose prompt was back-dismissed.
    if allowPrompt and resumePos <> invalid
        openResumeDialog(item, resumePos)
        return true
    end if
    m.pendingSeekPos = resumePos
    startPlaybackFlow(item)
    return true
end function

sub openResumeDialog(item as object, resumePos as float)
    m.resumeItem = item
    m.resumePos = resumePos
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = item.title
    dialog.buttons = ["Resume from " + FT_FormatDuration(resumePos), "Start from beginning"]
    dialog.ObserveField("buttonSelected", "onResumeButton")
    dialog.ObserveField("wasClosed", "onResumeClosed")
    m.resumeDialog = dialog
    m.top.dialog = dialog
end sub

' Gate S1: a back-dismissed resume dialog fires no buttonSelected; clear the
' dangling refs so nothing stale survives. Fires after onResumeButton too --
' the invalid guard makes that a no-op.
sub onResumeClosed()
    if m.resumeDialog = invalid then return
    m.resumeDialog.UnobserveField("buttonSelected")
    m.resumeDialog = invalid
    m.resumeItem = invalid
end sub

sub onResumeButton()
    if m.resumeDialog = invalid then return
    choice = m.resumeDialog.buttonSelected
    m.resumeDialog.close = true
    m.resumeDialog = invalid
    if choice = 0
        m.pendingSeekPos = m.resumePos
    else
        m.pendingSeekPos = invalid
    end if
    startPlaybackFlow(m.resumeItem)
    m.resumeItem = invalid
end sub

' ---- playback -------------------------------------------------------------

sub startPlaybackFlow(item as object)
    ' Advancing while something is on screen (menu next/prev, autoplay after
    ' an error dialog, etc.): tear the old playback down first so the gate's
    ' "Preparing…" status renders over the scene, not under a live video.
    if m.playbackMenuGroup.visible then closePlaybackMenu()
    if m.video.visible then stopPlaybackSurface()

    content = CreateObject("roSGNode", "ContentNode")
    content.url = m.state.serverUrl + "/video/" + item.ftId
    ' v1.46: ask the server for the Roku-safe rendition of video items --
    ' cover-art-stripped remux / rotation-baked re-encode when needed,
    ' the original bytes otherwise. Audio items skip it (server would too).
    if item.ftMediaType <> "audio"
        content.url = content.url + "?compat=roku"
    end if
    content.title = item.title
    ' Items flagged needsTranscode are served as a cached MP4 rendition
    ' regardless of their original container, so the extension must not
    ' drive the demuxer choice for them.
    if item.ftNeedsTranscode
        content.streamFormat = "mp4"
    else
        content.streamFormat = streamFormatForExt(item.ftExt)
    end if
    ' Sidecar captions: the server serves WebVTT (converting .srt on the
    ' fly), which the Video node takes natively. Toggle via * > CC.
    if item.ftHasSubtitles
        content.SubtitleTracks = [{
            Language: "en",
            Description: "Captions",
            TrackName: m.state.serverUrl + "/api/subtitles/" + item.ftId
        }]
    end if

    m.playingNeedsTranscode = item.ftNeedsTranscode
    m.playingExt = item.ftExt
    m.playingCodecs = item.ftCodecs
    m.playingIsVideo = (item.ftMediaType <> "audio")

    ' Audio files play through the same Video node but the surface is black;
    ' float the thumbnail and title so it reads as intentional playback.
    if item.ftMediaType = "audio"
        m.audioBackdrop.uri = item.HDPosterUrl
        m.audioArt.uri = item.HDPosterUrl
        m.audioTitle.text = item.title
        m.audioOverlay.visible = true
    end if

    m.pendingContent = content
    m.gridScreen.visible = false
    ' Binge prefetch: make sure the NEXT queue position is loaded before
    ' this one finishes, so autoplay never starves at the page boundary.
    m.gridScreen.ensureLoaded = m.queueIndex + 1

    if item.ftMediaType = "audio"
        beginPlayback()
    else
        beginPlaybackGate(content.url)
    end if
end sub

sub beginPlayback()
    m.statusLabel.visible = false
    m.video.control = "stop"
    m.video.content = m.pendingContent
    m.video.visible = true
    m.video.SetFocus(true)
    m.video.control = "play"
    ' Gate C1 (v1.47.1): progress pings attribute to a SNAPSHOT of the item
    ' whose bytes are on the surface -- playIndex moves m.currentItem to the
    ' NEXT item before the old surface tears down, and pinging via
    ' m.currentItem wrote video A's position onto video B's id.
    m.playingItem = m.currentItem
    m.playingFinished = false
    m.progressTimer.control = "start"
end sub

' ---- watch-progress write-back (v1.47.1) -----------------------------------

sub onProgressTick()
    sendProgressPing()
end sub

' Fire-and-forget: the web player's own POST /api/progress ping, so resume
' stays in sync across TV/web/phone, plus a session-local record so THIS
' session's resume prompts stay fresh mid-binge.
'
' v1.47.2 (Dean on-device: the video restarted every 30s, forever): the
' in-session position lives in a plain AA keyed by id -- NEVER on the item's
' ContentNode. Those nodes are live children of the grid's content AND the
' very node held in the observed `selectedItem` field, so mutating one
' notifies that field's observers (an ArrayGrid content rebuild is a
' plausible second path -- hence the guard in GridScreen too). This scene
' read the notification as a fresh OK press and re-entered playback, resume
' prompt included, on every ping.
function progressFor(item as object) as float
    if item = invalid or item.ftId = "" then return 0.0
    if m.sessionProgress.DoesExist(item.ftId) then return m.sessionProgress[item.ftId]
    return item.ftProgress
end function

sub sendProgressPing()
    if m.playingItem = invalid or m.playingItem.ftId = "" then return
    if m.playingFinished then return ' completion already wrote 0 (gate W1)
    if not m.video.visible then return
    position = m.video.position
    if position < 5 then return ' nothing meaningful to record yet
    postProgress(m.playingItem, position)
    m.sessionProgress[m.playingItem.ftId] = position
end sub

' Gate W1: the web's completion contract is a one-shot progress-0 write --
' without it, a video finished on the TV would offer "Resume at 59:58" on
' the phone. Mirrors public/js/player.js's 'ended' cascade.
sub sendProgressComplete()
    if m.playingItem = invalid or m.playingItem.ftId = "" then return
    postProgress(m.playingItem, 0)
    m.sessionProgress[m.playingItem.ftId] = 0.0
    m.playingFinished = true
end sub

sub postProgress(item as object, position as float)
    task = CreateObject("roSGNode", "ProgressTask")
    task.serverUrl = m.state.serverUrl
    task.cookie = m.state.cookie
    task.itemId = item.ftId
    task.position = position
    task.duration = item.ftDuration
    task.control = "RUN"
    m.progressTask = task ' hold a ref so the task isn't collected mid-run
end sub

' Pre-warm EXACTLY the next queue item (video only) with one silent request:
' its ?compat=roku rendition builds while this one plays, so autoplay/Next
' is usually instant. Guarded to once per played item -- item N+2 is never
' touched until N+1 actually plays (Dean's no-cascade constraint).
sub prewarmNext()
    if m.currentItem = invalid or m.prewarmedForId = m.currentItem.ftId then return
    if m.queue = invalid then return
    nextIndex = m.queueIndex + 1
    if nextIndex >= m.queue.GetChildCount() then return
    nextItem = m.queue.GetChild(nextIndex)
    if nextItem = invalid or nextItem.ftId = "" then return
    ' Guard AFTER a target resolves (gate S1): consuming it on a not-yet-
    ' loaded page boundary would permanently skip that item's warm.
    m.prewarmedForId = m.currentItem.ftId
    if nextItem.ftMediaType = "audio" then return ' audio never has renditions
    ' Gate W2: a needsTranscode next item would answer the probe by queueing
    ' a FULL browser transcode -- heavier processing than "warm a rendition"
    ' should ever trigger uninvited. Those keep the on-demand slow path.
    if nextItem.ftNeedsTranscode then return
    task = CreateObject("roSGNode", "PrewarmTask")
    task.url = m.state.serverUrl + "/video/" + nextItem.ftId + "?compat=roku"
    task.cookie = m.state.cookie
    task.control = "RUN"
    m.prewarmTask = task ' ref only so it isn't collected mid-run
end sub

sub beginPlaybackGate(url as string)
    m.gating = true
    m.gridScreen.gateActive = true ' gate W7: mute the hidden grid's keys
    showStatus("Preparing… (first play of some videos takes a minute)")
    m.gateTask = CreateObject("roSGNode", "PlaybackGateTask")
    m.gateTask.url = url
    m.gateTask.cookie = m.state.cookie
    m.gateTask.ObserveField("result", "onGateResult")
    m.gateTask.control = "RUN"
end sub

sub onGateResult()
    ' Stale-fire guard (v1.46 gate CRITICAL): cancelPlaybackGate UNOBSERVES
    ' the old task before dropping it, so the only node that can reach this
    ' callback is the CURRENT m.gateTask.
    if not m.gating then return
    if m.gateTask = invalid then return
    m.gating = false
    m.gridScreen.gateActive = false
    result = m.gateTask.result
    m.gateTask.UnobserveField("result")
    m.gateTask = invalid
    if result <> invalid and result.ok = true
        beginPlayback()
        return
    end if
    m.statusLabel.visible = false
    m.audioOverlay.visible = false
    m.gridScreen.visible = true
    m.gridScreen.takeFocus = true
    message = "Playback failed."
    if result <> invalid and result.error <> invalid and result.error <> "" then message = result.error
    showDialog("Playback", message)
end sub

sub cancelPlaybackGate()
    m.gating = false
    m.gridScreen.gateActive = false
    if m.gateTask <> invalid
        ' Unobserve BEFORE stop: task termination is asynchronous, and a
        ' still-observed field set by the dying thread would fire
        ' onGateResult against whatever task the pointer holds by then.
        m.gateTask.UnobserveField("result")
        m.gateTask.control = "STOP"
        m.gateTask = invalid
    end if
    m.statusLabel.visible = false
    m.gridScreen.visible = true
    m.gridScreen.takeFocus = true
end sub

function streamFormatForExt(ext as string) as string
    if ext = ".mkv" then return "mkv"
    if ext = ".mp3" then return "mp3"
    return "mp4"
end function

sub onVideoState()
    state = m.video.state
    if state = "playing"
        if m.pendingSeekPos <> invalid
            m.video.seek = m.pendingSeekPos
            m.pendingSeekPos = invalid
        end if
        prewarmNext() ' once per item; no-op on later playing transitions
    else if state = "finished"
        sendProgressComplete() ' gate W1: completion = progress 0, web parity
        advanceAfterFinish()
    else if state = "error"
        message = "Playback failed."
        if m.video.errorMsg <> invalid and m.video.errorMsg <> ""
            message = message + " (" + m.video.errorMsg + ")"
        end if
        ' Surface the file type and codecs so incompatibilities can be
        ' diagnosed from the TV itself; "codecs unrecorded" marks an item
        ' the ffprobe scan never probed (legacy import).
        if m.playingExt <> ""
            detail = m.playingExt
            if m.playingCodecs <> ""
                detail = detail + " " + m.playingCodecs
            else
                detail = detail + " codecs unrecorded"
            end if
            message = message + " [" + detail + "]"
        end if
        if m.playingNeedsTranscode
            message = message + " This file is being converted for streaming on the server — give it a minute or two and try again."
        else if m.playingIsVideo
            message = message + " If the server is preparing a Roku-friendly copy, trying again in a moment usually works."
        end if
        stopPlayback()
        showDialog("Playback", message)
    end if
end sub

' v1.47: end-of-item routing — loop-this replays from zero, autoplay/loop-all
' advance (wrapping only on loop-all), anything else lands back on the grid.
sub advanceAfterFinish()
    if m.loopMode = "this"
        if playIndex(m.queueIndex, false, true) then return
        stopPlayback()
        return
    end if
    count = 0
    if m.queue <> invalid then count = m.queue.GetChildCount()
    nextIndex = m.queueIndex + 1
    if nextIndex < count and (m.autoplay or m.loopMode = "all")
        if playIndex(nextIndex, false, false) then return
    end if
    ' Gate W3: the loop-all WRAP starts from zero too. A STALE near-end
    ' position (watched to 94% in some earlier session, so no completion-0
    ' was ever written) would re-finish instantly on the wrap and spin the
    ' loop -- the same reason loop-this passes fromStart. Items finished in
    ' THIS session are already 0 via sendProgressComplete.
    if m.loopMode = "all" and count > 0
        if playIndex(0, false, true) then return
    end if
    stopPlayback()
end sub

' Tear down the playback surface WITHOUT returning focus/visibility to the
' grid — used when another item starts immediately (next/prev/autoplay).
sub stopPlaybackSurface()
    ' Final progress ping BEFORE teardown, while video.position is still
    ' real -- attributed to m.playingItem (the SNAPSHOT of what actually
    ' played, gate C1) and skipped after a finish (completion wrote 0).
    sendProgressPing()
    m.playingItem = invalid
    m.progressTimer.control = "stop"
    m.video.control = "stop"
    m.video.visible = false
    m.video.content = invalid
    m.audioOverlay.visible = false
    m.audioArt.uri = ""
    m.audioBackdrop.uri = ""
end sub

sub stopPlayback()
    stopPlaybackSurface()
    if m.playbackMenuGroup.visible then closePlaybackMenu()
    m.gridScreen.visible = true
    m.gridScreen.takeFocus = true
end sub

' ---- playback menu (v1.47) -------------------------------------------------

sub openPlaybackMenu()
    m.menuMode = "main"
    buildPlaybackMenuRows()
    m.playbackMenu.jumpToItem = 0 ' gate S2: fresh menu, fresh focus
    m.playbackMenuGroup.visible = true
    m.playbackMenu.SetFocus(true)
    ' Chapters are only on the details endpoint; fetch once per item, lazily.
    if m.currentItem <> invalid and m.chaptersItemId <> m.currentItem.ftId
        ' Gate W1: unobserve-before-replace, same discipline as the gate task
        ' -- a superseded fetch must never fire into the new one's callback.
        if m.detailsTask <> invalid then m.detailsTask.UnobserveField("result")
        m.detailsTask = CreateObject("roSGNode", "DetailsTask")
        m.detailsTask.serverUrl = m.state.serverUrl
        m.detailsTask.cookie = m.state.cookie
        m.detailsTask.itemId = m.currentItem.ftId
        m.detailsTask.ObserveField("result", "onDetailsResult")
        m.detailsTask.control = "RUN"
    end if
end sub

sub onDetailsResult()
    if m.detailsTask = invalid then return
    result = m.detailsTask.result
    ' Unset assocarray task fields default to {} -- wait for the real result.
    if result = invalid or not result.DoesExist("ok") then return
    m.detailsTask.UnobserveField("result")
    m.detailsTask = invalid
    if m.currentItem = invalid or result.itemId <> m.currentItem.ftId then return
    m.chaptersItemId = result.itemId
    m.chapters = []
    if result.ok = true and type(result.chapters) = "roArray" then m.chapters = result.chapters
    ' A Chapters… row may have just become available while the menu is open.
    if m.playbackMenuGroup.visible and m.menuMode = "main" then buildPlaybackMenuRows()
end sub

sub buildPlaybackMenuRows()
    m.playbackMenuTitle.text = "Playback"
    m.menuActions = []
    count = 0
    if m.queue <> invalid then count = m.queue.GetChildCount()
    if m.queueIndex >= 0 and m.queueIndex + 1 < count
        m.menuActions.Push({ kind: "next", label: "Next:  " + m.queue.GetChild(m.queueIndex + 1).title })
    end if
    if m.queueIndex > 0
        m.menuActions.Push({ kind: "prev", label: "Previous:  " + m.queue.GetChild(m.queueIndex - 1).title })
    end if
    if m.currentItem <> invalid and m.chaptersItemId = m.currentItem.ftId and m.chapters.Count() > 0
        m.menuActions.Push({ kind: "chapters", label: "Chapters…  (" + m.chapters.Count().ToStr() + ")" })
    end if
    m.menuActions.Push({ kind: "loop", label: "Loop:  " + loopLabel() })
    autoplayText = "Off"
    if m.autoplay then autoplayText = "On"
    m.menuActions.Push({ kind: "autoplay", label: "Autoplay next:  " + autoplayText })
    m.menuActions.Push({ kind: "restart", label: "Restart from beginning" })

    focused = m.playbackMenu.itemFocused
    content = CreateObject("roSGNode", "ContentNode")
    for each action in m.menuActions
        row = content.CreateChild("ContentNode")
        row.title = action.label
    end for
    m.playbackMenu.content = content
    if focused > 0 and focused < m.menuActions.Count() then m.playbackMenu.jumpToItem = focused
end sub

function loopLabel() as string
    if m.loopMode = "this" then return "This video"
    if m.loopMode = "all" then return "All"
    return "Off"
end function

sub showChapterRows()
    m.menuMode = "chapters"
    m.playbackMenuTitle.text = "Chapters"
    content = CreateObject("roSGNode", "ContentNode")
    for each ch in m.chapters
        row = content.CreateChild("ContentNode")
        ts = FT_FormatDuration(ch.start)
        if ts = "" then ts = "0:00" ' gate S5: a chapter AT zero still shows a time
        row.title = ts + "   " + ch.title
    end for
    m.playbackMenu.content = content
end sub

sub onPlaybackMenuSelected()
    index = m.playbackMenu.itemSelected
    if m.menuMode = "chapters"
        if index >= 0 and index < m.chapters.Count()
            target = m.chapters[index].start
            closePlaybackMenu()
            m.video.seek = target
        end if
        return
    end if
    if index < 0 or index >= m.menuActions.Count() then return
    kind = m.menuActions[index].kind
    if kind = "next"
        playIndex(m.queueIndex + 1, false, false)
    else if kind = "prev"
        playIndex(m.queueIndex - 1, false, false)
    else if kind = "chapters"
        showChapterRows()
    else if kind = "loop"
        if m.loopMode = "off"
            m.loopMode = "this"
        else if m.loopMode = "this"
            m.loopMode = "all"
        else
            m.loopMode = "off"
        end if
        FT_RegistryWrite({ loopmode: m.loopMode })
        buildPlaybackMenuRows()
    else if kind = "autoplay"
        m.autoplay = not m.autoplay
        flag = "0"
        if m.autoplay then flag = "1"
        FT_RegistryWrite({ autoplay: flag })
        buildPlaybackMenuRows()
    else if kind = "restart"
        closePlaybackMenu()
        m.video.seek = 0
    end if
end sub

sub closePlaybackMenu()
    m.playbackMenuGroup.visible = false
    m.menuMode = "main"
    if m.video.visible then m.video.SetFocus(true)
end sub

' ---- keys ------------------------------------------------------------------

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "back" and m.gating
        cancelPlaybackGate()
        return true
    end if
    if m.playbackMenuGroup.visible
        if key = "back"
            if m.menuMode = "chapters"
                m.menuMode = "main"
                buildPlaybackMenuRows()
                m.playbackMenuTitle.text = "Playback"
            else
                closePlaybackMenu()
            end if
            return true
        end if
        return false
    end if
    if key = "down" and m.video.visible
        openPlaybackMenu()
        return true
    end if
    if key = "back" and m.video.visible
        stopPlayback()
        return true
    end if
    return false
end function

' ---- helpers --------------------------------------------------------------

sub showLogin()
    m.statusLabel.visible = false
    m.loginScreen.visible = true
    m.loginScreen.takeFocus = true
end sub

sub showStatus(text as string)
    m.statusLabel.text = text
    m.statusLabel.visible = true
end sub

sub showDialog(title as string, message as string)
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = title
    dialog.message = message
    dialog.buttons = ["OK"]
    dialog.ObserveField("buttonSelected", "onDialogButton")
    m.dialog = dialog
    m.top.dialog = dialog
end sub

sub onDialogButton()
    if m.dialog <> invalid then m.dialog.close = true
    m.dialog = invalid
end sub
