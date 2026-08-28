sub init()
    m.grid = m.top.FindNode("grid")
    m.countLabel = m.top.FindNode("countLabel")
    m.emptyLabel = m.top.FindNode("emptyLabel")
    m.libHint = m.top.FindNode("libHint")
    m.folderScrim = m.top.FindNode("folderScrim")
    m.folderTitle = m.top.FindNode("folderTitle")
    m.folderMenu = m.top.FindNode("folderMenu")
    m.grid.ObserveField("itemSelected", "onItemSelected")
    m.grid.ObserveField("itemFocused", "onItemFocused")
    m.folderMenu.ObserveField("itemSelected", "onFolderSelected")
    m.pageSize = 60
    m.total = 0
    m.loading = false
    m.roots = []
    m.currentRoot = ""
    m.currentRootName = "All videos"
    m.currentSearch = ""
    ' v1.47: media-type filter ("" all | "video" | "audio"), persisted; the
    ' channels drill-down ("" = none); and which view the grid is showing.
    saved = FT_RegistryRead()
    m.filterMode = ""
    if saved.filtermode = "video" or saved.filtermode = "audio" then m.filterMode = saved.filtermode
    m.currentFolder = ""
    m.currentFolderName = ""
    ' v1.199 adds the Shows drill-down: shows -> seasons -> episodes.
    m.viewMode = "videos" ' "videos" | "channels" | "shows" | "seasons" | "episodes"
    m.channels = []
    m.shows = []
    m.showDetail = invalid
    m.currentSeasonIndex = -1
    m.seasonAutoSkip = false
    m.menuRows = []
end sub

sub onTakeFocus()
    if m.folderMenu.visible
        m.folderMenu.SetFocus(true)
    else
        m.grid.SetFocus(true)
    end if
end sub

sub updateHint()
    ' Dean on-device: "RIGHT/*" clipped and looked bad -- the hint names only
    ' * (Right still works at a row edge, just undocumented on screen).
    parts = "UP search · * filter"
    if m.roots.Count() > 0
        parts = "LEFT libraries · " + parts
    end if
    m.libHint.text = parts
    m.libHint.visible = true
end sub

sub onBegin()
    if not m.top.begin then return
    ' A re-login can land here with the picker still open from before the
    ' session expired; close it so focus and visibility agree.
    if m.folderMenu.visible then closeFolderMenu()
    if m.roots.Count() = 0 then fetchConfig()
    m.currentSearch = ""
    m.currentFolder = ""
    m.currentFolderName = ""
    m.viewMode = "videos"
    m.showDetail = invalid
    m.currentSeasonIndex = -1
    m.seasonAutoSkip = false
    updateHint()
    resetAndLoad()
    m.grid.SetFocus(true)
end sub

sub resetAndLoad()
    m.total = 0
    m.loading = false
    m.emptyLabel.visible = false
    m.countLabel.text = "Loading…"
    m.contentRoot = CreateObject("roSGNode", "ContentNode")
    if m.viewMode = "channels"
        applyGridGeometry("landscape")
        m.grid.itemComponentName = "ChannelItem"
        m.grid.content = m.contentRoot
        fetchChannels()
    else if m.viewMode = "shows"
        ' Gate (v1.199 round 1, W1): a detail fetch left pending by a PREVIOUS
        ' visit must never fire into a re-entered wall (its viewMode guard
        ' passes again here) - this is the one choke point every entry to the
        ' shows view passes through, so unobserve it before the wall loads.
        if m.showDetailTask <> invalid then m.showDetailTask.UnobserveField("result")
        applyGridGeometry("portrait")
        m.grid.itemComponentName = "ShowItem"
        m.grid.content = m.contentRoot
        fetchShows()
    else if m.viewMode = "seasons"
        ' Rendered from the cached ShowDetail result -- no second fetch.
        applyGridGeometry("portrait")
        m.grid.itemComponentName = "ShowItem"
        m.grid.content = m.contentRoot
        buildSeasonNodes()
    else if m.viewMode = "episodes"
        applyGridGeometry("landscape")
        m.grid.itemComponentName = "GridItem"
        m.grid.content = m.contentRoot
        buildEpisodeNodes()
    else
        applyGridGeometry("landscape")
        m.grid.itemComponentName = "GridItem"
        m.grid.content = m.contentRoot
        m.top.queue = m.contentRoot
        fetchPage(0)
    end if
end sub

' The Shows wall + season tiles are 2:3 posters (the web page's poster wall);
' everything else keeps the 16:9 thumb cells. Applied per resetAndLoad so
' every mode change re-asserts its own geometry.
sub applyGridGeometry(mode as string)
    if mode = "portrait"
        ' Bigger poster tiles (v1.199.1): 256x384 poster + a wrapped 2-line title
        ' and two count lines below at the proven 28px pitch (metaBottom bottom
        ' 480+28=508 < 512 cell). 6 columns: 6*256 + 5*24 spacing + 64 left =
        ' 1720 < 1920. Row 2 peeks (~78% at 1080: 1080-(140+512+28)=400, 400/512)
        ' which is the poster-wall scroll cue, not a clip bug.
        m.grid.itemSize = [256, 512]
        m.grid.numColumns = 6
        m.grid.numRows = 2
    else
        m.grid.itemSize = [336, 252]
        m.grid.numColumns = 5
        m.grid.numRows = 3
    end if
end sub

' ---- libraries picker -----------------------------------------------------

sub fetchConfig()
    m.configTask = CreateObject("roSGNode", "ConfigTask")
    m.configTask.serverUrl = m.top.serverUrl
    m.configTask.cookie = m.top.cookie
    m.configTask.ObserveField("result", "onConfigResult")
    m.configTask.control = "RUN"
end sub

sub onConfigResult()
    result = m.configTask.result
    if result = invalid or result.ok <> true or type(result.roots) <> "roArray" then return
    m.roots = [{ name: "All videos", root: "" }]
    m.roots.Append(result.roots)
    updateHint()
end sub

sub openFolderMenu()
    content = CreateObject("roSGNode", "ContentNode")
    ' v1.199: KIND-tagged rows (m.menuRows mirrors the list positionally), so
    ' dispatch never does index math against a list that can grow.
    m.menuRows = []
    for each entry in m.roots
        row = content.CreateChild("ContentNode")
        row.title = entry.name
        m.menuRows.Push({ kind: "root", root: entry.root, name: entry.name })
    end for
    ' v1.47: the Channels drill-down rides the same picker; v1.199 adds Shows.
    ' Both unconditional (an empty Shows library answers with an honest empty
    ' grid, the Channels posture).
    row = content.CreateChild("ContentNode")
    row.title = "Channels"
    m.menuRows.Push({ kind: "channels" })
    row = content.CreateChild("ContentNode")
    row.title = "Shows"
    m.menuRows.Push({ kind: "shows" })
    m.folderMenu.content = content
    m.folderScrim.visible = true
    m.folderTitle.visible = true
    m.folderMenu.visible = true
    m.folderMenu.SetFocus(true)
end sub

sub closeFolderMenu()
    m.folderScrim.visible = false
    m.folderTitle.visible = false
    m.folderMenu.visible = false
    m.grid.SetFocus(true)
end sub

sub onFolderSelected()
    index = m.folderMenu.itemSelected
    if index < 0 or index >= m.menuRows.Count() then return
    closeFolderMenu()
    row = m.menuRows[index]
    if row.kind = "channels"
        m.viewMode = "channels"
        m.currentSearch = ""
        resetAndLoad()
        return
    end if
    if row.kind = "shows"
        m.viewMode = "shows"
        m.currentSearch = ""
        m.showDetail = invalid
        m.currentSeasonIndex = -1
        m.seasonAutoSkip = false
        resetAndLoad()
        return
    end if
    m.currentRoot = row.root
    m.currentRootName = row.name
    m.currentSearch = ""
    m.currentFolder = ""
    m.currentFolderName = ""
    m.viewMode = "videos"
    resetAndLoad()
end sub

' ---- channels view --------------------------------------------------------

sub fetchChannels()
    ' Gate W2: unobserve-before-replace (the v1.46 task discipline) so a
    ' superseded fetch can never fire into the new one's callback.
    if m.channelsTask <> invalid then m.channelsTask.UnobserveField("result")
    m.channelsTask = CreateObject("roSGNode", "ChannelsTask")
    m.channelsTask.serverUrl = m.top.serverUrl
    m.channelsTask.cookie = m.top.cookie
    m.channelsTask.root = m.currentRoot
    m.channelsTask.ObserveField("result", "onChannelsResult")
    m.channelsTask.control = "RUN"
end sub

sub onChannelsResult()
    result = m.channelsTask.result
    if result = invalid or not result.DoesExist("ok") then return
    if m.viewMode <> "channels" then return ' user navigated away mid-fetch
    if result.ok <> true
        if result.code <> invalid and result.code = 401
            m.top.authExpired = true
        else
            m.top.loadError = result.error
        end if
        return
    end if
    ' Gate W2: a stale task's late fire (view re-entered while a fetch was in
    ' flight) must not double-append -- a channels contentRoot is built fresh
    ' per resetAndLoad, so any existing children mean this result is stale.
    if m.contentRoot.GetChildCount() > 0 then return
    m.channels = result.channels
    for each ch in m.channels
        node = CreateObject("roSGNode", "ContentNode")
        ' Gate W6: avatar in a CUSTOM field only, never HDPosterUrl (see
        ' ChannelItem.brs -- keeps the remote URL away from any
        ' scene-agent-inheriting Poster).
        node.AddFields({ ftDurationText: "", ftFolder: "", ftAvatarUrl: "" })
        node.title = ch.name
        node.ftFolder = ch.folder
        node.ftDurationText = ch.count.ToStr() + " items"
        if ch.avatarUrl <> "" then node.ftAvatarUrl = ch.avatarUrl
        m.contentRoot.AppendChild(node)
    end for
    m.countLabel.text = "Channels · " + m.channels.Count().ToStr() + " in " + m.currentRootName
    m.emptyLabel.text = "No channels found."
    m.emptyLabel.visible = (m.channels.Count() = 0)
end sub

' ---- shows view (v1.199) ---------------------------------------------------

sub fetchShows()
    ' Unobserve-before-replace (the v1.46 task discipline), same as channels.
    if m.showsTask <> invalid then m.showsTask.UnobserveField("result")
    m.showsTask = CreateObject("roSGNode", "ShowsTask")
    m.showsTask.serverUrl = m.top.serverUrl
    m.showsTask.cookie = m.top.cookie
    m.showsTask.ObserveField("result", "onShowsResult")
    m.showsTask.control = "RUN"
end sub

sub onShowsResult()
    result = m.showsTask.result
    if result = invalid or not result.DoesExist("ok") then return
    if m.viewMode <> "shows" then return ' user navigated away mid-fetch
    if result.ok <> true
        if result.code <> invalid and result.code = 401
            m.top.authExpired = true
        else
            m.top.loadError = result.error
        end if
        return
    end if
    ' Stale late fire: the shows contentRoot is built fresh per resetAndLoad,
    ' so any existing children mean this result is superseded.
    if m.contentRoot.GetChildCount() > 0 then return
    m.shows = result.shows
    for each sh in m.shows
        node = CreateObject("roSGNode", "ContentNode")
        node.AddFields({ ftShowId: "", ftDurationText: "", ftMetaTop: "", ftMetaBottom: "" })
        node.title = sh.name
        node.ftShowId = sh.id
        ' Season/episode counts split onto their own lines (ShowItem stacks them);
        ' ftDurationText kept as the single-line join for parity/diagnostics.
        node.ftMetaTop = pluralCount(sh.seasonCount, "season")
        node.ftMetaBottom = pluralCount(sh.episodeCount, "episode")
        node.ftDurationText = node.ftMetaTop + " · " + node.ftMetaBottom
        ' First-party poster: HDPosterUrl + the inherited scene agent is correct
        ' (ids are md5 hex, URL-safe by construction -- the /thumbnail/ pattern).
        node.HDPosterUrl = m.top.serverUrl + "/tvposter/" + sh.id
        m.contentRoot.AppendChild(node)
    end for
    m.countLabel.text = "Shows · " + m.shows.Count().ToStr()
    m.emptyLabel.text = "No shows found."
    m.emptyLabel.visible = (m.shows.Count() = 0)
end sub

sub fetchShowDetail(showId as string)
    m.countLabel.text = "Loading…"
    if m.showDetailTask <> invalid then m.showDetailTask.UnobserveField("result")
    m.showDetailTask = CreateObject("roSGNode", "ShowDetailTask")
    m.showDetailTask.serverUrl = m.top.serverUrl
    m.showDetailTask.cookie = m.top.cookie
    m.showDetailTask.showId = showId
    m.showDetailTask.ObserveField("result", "onShowDetailResult")
    m.showDetailTask.control = "RUN"
end sub

sub onShowDetailResult()
    result = m.showDetailTask.result
    if result = invalid or not result.DoesExist("ok") then return
    if m.viewMode <> "shows" then return ' user navigated away mid-fetch
    if result.ok <> true
        if result.code <> invalid and result.code = 401
            m.top.authExpired = true
        else if result.code <> invalid and result.code = 404
            ' Gone (or restricted since the wall loaded): refresh the wall so
            ' the stale tile disappears -- an empty answer that self-heals,
            ' never an error dialog (the no-oracle posture).
            resetAndLoad()
        else
            m.top.loadError = result.error
        end if
        return
    end if
    if result.seasons.Count() = 0
        ' Defensive only (the real route 404s a season-less show) - but never
        ' strand the header on "Loading…" if it ever fires.
        m.countLabel.text = "Shows · " + m.shows.Count().ToStr()
        m.emptyLabel.text = "No episodes found."
        m.emptyLabel.visible = true
        return
    end if
    m.showDetail = result
    if result.seasons.Count() = 1
        ' A single-season show goes straight to its episodes (the web page's
        ' single-season posture); Back knows to skip seasons on the way out.
        m.seasonAutoSkip = true
        m.currentSeasonIndex = 0
        m.viewMode = "episodes"
    else
        m.seasonAutoSkip = false
        m.currentSeasonIndex = -1
        m.viewMode = "seasons"
    end if
    resetAndLoad()
end sub

sub buildSeasonNodes()
    if m.showDetail = invalid then return
    for each s in m.showDetail.seasons
        node = CreateObject("roSGNode", "ContentNode")
        node.AddFields({ ftDurationText: "", ftMetaTop: "", ftMetaBottom: "" })
        node.title = s.label
        ' Season tile: one count line ("M episodes"); ftMetaBottom stays "" so
        ' ShowItem hides its second line.
        node.ftMetaTop = pluralCount(s.episodes.Count(), "episode")
        node.ftDurationText = node.ftMetaTop
        node.HDPosterUrl = m.top.serverUrl + "/tvposter/" + m.showDetail.showId
        m.contentRoot.AppendChild(node)
    end for
    m.countLabel.text = m.showDetail.name + " · " + pluralCount(m.showDetail.seasons.Count(), "season")
end sub

sub buildEpisodeNodes()
    if m.showDetail = invalid or m.currentSeasonIndex < 0 then return
    if m.currentSeasonIndex >= m.showDetail.seasons.Count() then return
    season = m.showDetail.seasons[m.currentSeasonIndex]
    for each ep in season.episodes
        m.contentRoot.AppendChild(buildEpisodeContentNode(ep))
    end for
    scope = m.showDetail.name
    if m.showDetail.seasons.Count() > 1 then scope = scope + " · " + season.label
    m.countLabel.text = scope + " · " + pluralCount(season.episodes.Count(), "episode")
end sub

' An episode node carries the SAME playback fields buildContentNode gives a
' video (AppScene reads them identically), plus ftSource="tv" so the playback
' flow streams /tvepisode and writes the tv progress keyspace.
function buildEpisodeContentNode(ep as object) as object
    node = CreateObject("roSGNode", "ContentNode")
    node.AddFields({
        ftId: "",
        ftSource: "tv",
        ftDurationText: "",
        ftDuration: 0.0,
        ftProgress: 0.0,
        ftNeedsTranscode: false,
        ftHasSubtitles: false,
        ftMediaType: "video",
        ftExt: "",
        ftCodecs: ""
    })
    node.ftId = ep.id
    title = ep.title
    code = epCode(ep.seasonNum, ep.episodeNum)
    if code <> ""
        if title <> "" then title = code + "  " + title else title = code
    end if
    node.title = title
    node.ftExt = ep.ext
    node.ftCodecs = ep.codecs ' playback-error diagnostics, the video-tile parity
    node.ftDuration = ep.durationSec
    node.ftDurationText = FT_FormatDuration(ep.durationSec)
    node.ftProgress = ep.progress
    node.ftNeedsTranscode = ep.needsTranscode
    node.HDPosterUrl = m.top.serverUrl + "/tvthumb/" + ep.id
    return node
end function

function epCode(seasonNum as integer, episodeNum as integer) as string
    if seasonNum < 0 or episodeNum < 0 then return "" ' an Extras file: no SxxEyy
    return "S" + FT_Pad2(seasonNum) + "E" + FT_Pad2(episodeNum)
end function

function pluralCount(n as integer, word as string) as string
    if n = 1 then return "1 " + word
    return n.ToStr() + " " + word + "s"
end function

' ---- search ---------------------------------------------------------------

sub openSearch()
    kb = CreateObject("roSGNode", "KeyboardDialog")
    kb.title = "Search videos"
    kb.text = m.currentSearch
    kb.buttons = ["Search", "Cancel"]
    kb.ObserveField("buttonSelected", "onSearchKeyboard")
    m.searchKb = kb
    m.top.GetScene().dialog = kb
end sub

sub onSearchKeyboard()
    if m.searchKb = invalid then return
    if m.searchKb.buttonSelected = 0
        m.currentSearch = m.searchKb.text.Trim()
        m.viewMode = "videos"
        resetAndLoad()
    end if
    m.searchKb.close = true
    m.searchKb = invalid
end sub

' ---- media-type filter (v1.47) ---------------------------------------------

sub cycleFilter()
    if m.filterMode = ""
        m.filterMode = "video"
    else if m.filterMode = "video"
        m.filterMode = "audio"
    else
        m.filterMode = ""
    end if
    FT_RegistryWrite({ filtermode: m.filterMode })
    if m.viewMode = "videos" then resetAndLoad()
end sub

function filterLabel() as string
    if m.filterMode = "video" then return " · video only"
    if m.filterMode = "audio" then return " · audio only"
    return ""
end function

' ---- keys ------------------------------------------------------------------

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    ' Gate W7: hidden-but-focused during "Preparing…" -- swallow everything
    ' except Back (which bubbles to AppScene's gate cancel). Without this,
    ' Left/Up/Right during the gate drive an invisible UI.
    if m.top.gateActive then return (key <> "back")
    if m.folderMenu.visible
        if key = "back" or key = "left"
            closeFolderMenu()
            return true
        end if
        return false
    end if
    if key = "left" and m.roots.Count() > 0
        openFolderMenu()
        return true
    end if
    if key = "up"
        openSearch()
        return true
    end if
    ' RIGHT reaches here only at a row's right edge (the grid consumes inner
    ' presses); * (options) works from anywhere -- both cycle the filter.
    ' Gate S7: a filter change is invisible from the channels view, so it's
    ' a no-op there rather than a silent persisted surprise.
    if key = "right" or key = "options"
        if m.viewMode = "videos" then cycleFilter()
        return true
    end if
    if key = "back"
        ' v1.199 TV back-stack: episodes -> seasons -> shows -> plain grid (a
        ' single-season show skipped seasons on the way in, so Back skips it too).
        if m.viewMode = "episodes"
            if m.seasonAutoSkip
                m.viewMode = "shows"
            else
                m.viewMode = "seasons"
            end if
            resetAndLoad()
            return true
        end if
        if m.viewMode = "seasons"
            m.viewMode = "shows"
            resetAndLoad()
            return true
        end if
        if m.viewMode = "shows"
            m.viewMode = "videos"
            resetAndLoad()
            return true
        end if
        ' Drill-down back-stack: channel videos -> channels list -> plain grid.
        if m.viewMode = "videos" and m.currentFolder <> ""
            m.currentFolder = ""
            m.currentFolderName = ""
            m.viewMode = "channels"
            resetAndLoad()
            return true
        end if
        if m.viewMode = "channels"
            m.viewMode = "videos"
            resetAndLoad()
            return true
        end if
        return false ' plain grid: let Back exit the channel (app)
    end if
    return false
end function

' ---- library pages ---------------------------------------------------------

sub fetchPage(offset as integer)
    if m.loading then return
    m.loading = true
    m.task = CreateObject("roSGNode", "VideosTask")
    m.task.serverUrl = m.top.serverUrl
    m.task.cookie = m.top.cookie
    m.task.offset = offset
    m.task.limit = m.pageSize
    m.task.root = m.currentRoot
    m.task.search = m.currentSearch
    m.task.format = m.filterMode
    m.task.folder = m.currentFolder
    m.task.ObserveField("result", "onPageResult")
    m.task.control = "RUN"
end sub

sub onPageResult()
    ' A stale task's observer can fire after a begin-reset; the current task's
    ' result lacks the "ok" key until it completes (unset assocarray fields
    ' default to {}), so this guard keeps the fetch gate closed until then.
    result = m.task.result
    if result = invalid or not result.DoesExist("ok") then return
    m.loading = false

    if result.ok <> true
        if result.code <> invalid and result.code = 401
            m.top.authExpired = true
        else
            m.top.loadError = result.error
        end if
        return
    end if

    if m.viewMode <> "videos" then return ' stale page after a view switch

    ' Root-switching makes stale observers a real sequence: only append a
    ' page that starts exactly where the loaded content currently ends.
    if result.offset <> m.contentRoot.GetChildCount() then return

    m.total = result.total
    for each item in result.items
        m.contentRoot.AppendChild(buildContentNode(item))
    end for

    shown = m.contentRoot.GetChildCount()
    scope = m.currentRootName
    if m.currentFolderName <> "" then scope = m.currentFolderName
    scope = scope + filterLabel()
    if m.currentSearch <> ""
        scope = scope + " · " + Chr(34) + m.currentSearch + Chr(34)
        m.emptyLabel.text = "No matches for " + Chr(34) + m.currentSearch + Chr(34) + "."
    else
        m.emptyLabel.text = "Nothing here."
    end if
    m.countLabel.text = scope + " · " + shown.ToStr() + " of " + m.total.ToStr() + " · newest first"
    m.emptyLabel.visible = (m.total = 0)
end sub

function buildContentNode(item as object) as object
    node = CreateObject("roSGNode", "ContentNode")
    node.AddFields({
        ftId: "",
        ftSource: "", ' v1.199: "" = the video library; "tv" = an episode node
        ftDurationText: "",
        ftDuration: 0.0,
        ftProgress: 0.0,
        ftNeedsTranscode: false,
        ftHasSubtitles: false,
        ftMediaType: "",
        ftExt: "",
        ftCodecs: ""
    })
    if item.id <> invalid then node.ftId = item.id
    if item.title <> invalid then node.title = item.title
    if item.ext <> invalid then node.ftExt = LCase(item.ext)
    if GetInterface(item.mediaType, "ifString") <> invalid then node.ftMediaType = item.mediaType
    ' Codec fields exist only where the ffprobe scan recorded them; their
    ' absence is itself diagnostic (legacy-imported item, never probed).
    codecs = ""
    if GetInterface(item.videoCodec, "ifString") <> invalid then codecs = item.videoCodec
    if GetInterface(item.audioCodec, "ifString") <> invalid
        if codecs <> "" then codecs = codecs + "/"
        codecs = codecs + item.audioCodec
    end if
    node.ftCodecs = codecs
    if item.duration <> invalid
        node.ftDuration = item.duration
        node.ftDurationText = FT_FormatDuration(item.duration)
    end if
    if item.progress <> invalid then node.ftProgress = item.progress
    node.ftNeedsTranscode = (item.needsTranscode = true)
    node.ftHasSubtitles = (item.hasSubtitles = true)
    if item.hasThumbnail = true and item.id <> invalid
        node.HDPosterUrl = m.top.serverUrl + "/thumbnail/" + item.id
    end if
    return node
end function

sub onItemSelected()
    ' v1.47.2 defense in depth: a selection cannot be a real OK press while
    ' the grid is off screen, so never propagate one. (The v1.47.1 restart
    ' loop reached AppScene through the observed selectedItem NODE being
    ' mutated; layer 1 removed that write, this closes the path itself --
    ' including page appends into the attached content during playback.)
    if not m.top.visible or m.top.gateActive then return
    index = m.grid.itemSelected
    if m.contentRoot = invalid or index < 0 or index >= m.contentRoot.GetChildCount() then return
    if m.viewMode = "channels"
        picked = m.contentRoot.GetChild(index)
        m.currentFolder = picked.ftFolder
        m.currentFolderName = picked.title
        m.viewMode = "videos"
        resetAndLoad()
        return
    end if
    if m.viewMode = "shows"
        picked = m.contentRoot.GetChild(index)
        fetchShowDetail(picked.ftShowId)
        return
    end if
    if m.viewMode = "seasons"
        m.currentSeasonIndex = index
        m.viewMode = "episodes"
        resetAndLoad()
        return
    end if
    ' "episodes" falls through to the trio below: the SEASON's episode list is
    ' the playback queue, so next/prev/autoplay ride the existing machinery.
    ' Set index + queue BEFORE selectedItem: AppScene's observer reads all
    ' three, and field-set order is its coherence guarantee.
    m.top.selectedIndex = index
    m.top.queue = m.contentRoot
    m.top.selectedItem = m.contentRoot.GetChild(index)
end sub

' Infinite scroll: fetch the next page when focus nears the loaded tail.
sub onItemFocused()
    if m.viewMode <> "videos" then return
    if m.contentRoot = invalid or m.loading then return
    loaded = m.contentRoot.GetChildCount()
    if loaded >= m.total then return
    if m.grid.itemFocused >= loaded - (m.grid.numColumns * 2)
        fetchPage(loaded)
    end if
end sub

' Playback prefetch (v1.47): AppScene names the queue index it needs next;
' load another page when that nears the loaded tail so autoplay never
' starves mid-binge.
sub onEnsureLoaded()
    if m.viewMode <> "videos" then return
    if m.contentRoot = invalid or m.loading then return
    loaded = m.contentRoot.GetChildCount()
    if loaded >= m.total then return
    if m.top.ensureLoaded >= loaded - 10
        fetchPage(loaded)
    end if
end sub
