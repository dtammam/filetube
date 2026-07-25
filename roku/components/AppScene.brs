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
    m.pendingSeekPos = invalid
    m.playingExt = ""
    m.playingCodecs = ""
    m.gating = false

    m.loginScreen.ObserveField("credentials", "onCredentials")
    m.gridScreen.ObserveField("selectedItem", "onItemSelected")
    m.gridScreen.ObserveField("loadError", "onGridLoadError")
    m.gridScreen.ObserveField("authExpired", "onAuthExpired")
    m.video.ObserveField("state", "onVideoState")

    m.state = FT_RegistryRead()
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
    FT_RegistryClearSession()
    m.state.cookie = ""
    m.gridScreen.visible = false
    showLogin()
    showDialog("Signed out", "Your session expired. Please sign in again.")
end sub

' ---- playback -------------------------------------------------------------

sub onItemSelected()
    item = m.gridScreen.selectedItem
    if item = invalid or item.ftId = "" then return

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
    ' regardless of their original container (e.g. an MKV with AC-3 audio),
    ' so the extension must not drive the demuxer choice for them.
    if item.ftNeedsTranscode
        content.streamFormat = "mp4"
    else
        content.streamFormat = streamFormatForExt(item.ftExt)
    end if

    ' Sidecar captions: the server serves WebVTT (converting .srt on the fly),
    ' which the Video node takes natively. Toggle via * > Closed Captions.
    if item.ftHasSubtitles
        content.SubtitleTracks = [{
            Language: "en",
            Description: "Captions",
            TrackName: m.state.serverUrl + "/api/subtitles/" + item.ftId
        }]
    end if

    ' Resume where the web player left off (server already tracks progress).
    m.pendingSeekPos = invalid
    if item.ftProgress >= 30
        if item.ftDuration <= 0 or item.ftProgress < 0.95 * item.ftDuration
            m.pendingSeekPos = item.ftProgress
        end if
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
    ' Seamless start: video items are pre-flighted so a rendition/transcode
    ' being built server-side shows "Preparing…" and auto-starts when ready,
    ' instead of erroring and needing a second press. Audio plays direct.
    if item.ftMediaType = "audio"
        beginPlayback()
    else
        beginPlaybackGate(content.url)
    end if
end sub

sub beginPlayback()
    m.statusLabel.visible = false
    m.video.content = m.pendingContent
    m.video.visible = true
    m.video.SetFocus(true)
    m.video.control = "play"
end sub

sub beginPlaybackGate(url as string)
    m.gating = true
    showStatus("Preparing… (first play of some videos takes a minute)")
    m.gateTask = CreateObject("roSGNode", "PlaybackGateTask")
    m.gateTask.url = url
    m.gateTask.cookie = m.state.cookie
    m.gateTask.ObserveField("result", "onGateResult")
    m.gateTask.control = "RUN"
end sub

sub onGateResult()
    if not m.gating then return
    m.gating = false
    result = invalid
    if m.gateTask <> invalid then result = m.gateTask.result
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
    if m.gateTask <> invalid
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
    else if state = "finished"
        stopPlayback()
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

sub stopPlayback()
    m.video.control = "stop"
    m.video.visible = false
    m.video.content = invalid
    m.audioOverlay.visible = false
    m.audioArt.uri = ""
    m.audioBackdrop.uri = ""
    m.gridScreen.visible = true
    m.gridScreen.takeFocus = true
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if press and key = "back" and m.gating
        cancelPlaybackGate()
        return true
    end if
    if press and key = "back" and m.video.visible
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
