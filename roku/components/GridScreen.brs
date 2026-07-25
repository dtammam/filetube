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
    m.viewMode = "videos" ' "videos" | "channels"
    m.channels = []
end sub

sub onTakeFocus()
    if m.folderMenu.visible
        m.folderMenu.SetFocus(true)
    else
        m.grid.SetFocus(true)
    end if
end sub

sub updateHint()
    parts = "UP search · RIGHT/* filter"
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
        m.grid.itemComponentName = "ChannelItem"
        m.grid.content = m.contentRoot
        fetchChannels()
    else
        m.grid.itemComponentName = "GridItem"
        m.grid.content = m.contentRoot
        m.top.queue = m.contentRoot
        fetchPage(0)
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
    for each entry in m.roots
        row = content.CreateChild("ContentNode")
        row.title = entry.name
    end for
    ' v1.47: the Channels drill-down rides the same picker, always last.
    row = content.CreateChild("ContentNode")
    row.title = "Channels"
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
    if index < 0 then return
    closeFolderMenu()
    if index >= m.roots.Count()
        ' The trailing "Channels" row.
        m.viewMode = "channels"
        m.currentSearch = ""
        resetAndLoad()
        return
    end if
    m.currentRoot = m.roots[index].root
    m.currentRootName = m.roots[index].name
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
