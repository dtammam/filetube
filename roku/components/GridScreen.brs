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
end sub

sub updateHint()
    if m.roots.Count() > 1
        m.libHint.text = "LEFT: libraries · UP: search"
    else
        m.libHint.text = "UP: search"
    end if
    m.libHint.visible = true
end sub

sub onTakeFocus()
    if m.folderMenu.visible
        m.folderMenu.SetFocus(true)
    else
        m.grid.SetFocus(true)
    end if
end sub

sub onBegin()
    if not m.top.begin then return
    ' A re-login can land here with the picker still open from before the
    ' session expired; close it so focus and visibility agree.
    if m.folderMenu.visible then closeFolderMenu()
    if m.roots.Count() = 0 then fetchConfig()
    m.currentSearch = ""
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
    m.grid.content = m.contentRoot
    fetchPage(0)
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
    ' A picker with only "All videos" in it is noise; need 2+ real choices.
    updateHint()
end sub

sub openFolderMenu()
    content = CreateObject("roSGNode", "ContentNode")
    for each entry in m.roots
        row = content.CreateChild("ContentNode")
        row.title = entry.name
    end for
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
    if index < 0 or index >= m.roots.Count() then return
    m.currentRoot = m.roots[index].root
    m.currentRootName = m.roots[index].name
    m.currentSearch = ""
    closeFolderMenu()
    resetAndLoad()
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
        resetAndLoad()
    end if
    m.searchKb.close = true
    m.searchKb = invalid
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if m.folderMenu.visible
        if key = "back" or key = "left"
            closeFolderMenu()
            return true
        end if
        return false
    end if
    if key = "left" and m.roots.Count() > 1
        openFolderMenu()
        return true
    end if
    if key = "up"
        openSearch()
        return true
    end if
    return false
end function

' ---- library pages --------------------------------------------------------

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

    ' Root-switching makes stale observers a real sequence: only append a
    ' page that starts exactly where the loaded content currently ends.
    if result.offset <> m.contentRoot.GetChildCount() then return

    m.total = result.total
    for each item in result.items
        m.contentRoot.AppendChild(buildContentNode(item))
    end for

    shown = m.contentRoot.GetChildCount()
    scope = m.currentRootName
    if m.currentSearch <> ""
        scope = scope + " · " + Chr(34) + m.currentSearch + Chr(34)
        m.emptyLabel.text = "No matches for " + Chr(34) + m.currentSearch + Chr(34) + "."
    else
        m.emptyLabel.text = "No videos found in the library."
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
    m.top.selectedItem = m.contentRoot.GetChild(index)
end sub

' Infinite scroll: fetch the next page when focus nears the loaded tail.
sub onItemFocused()
    if m.contentRoot = invalid or m.loading then return
    loaded = m.contentRoot.GetChildCount()
    if loaded >= m.total then return
    if m.grid.itemFocused >= loaded - (m.grid.numColumns * 2)
        fetchPage(loaded)
    end if
end sub
