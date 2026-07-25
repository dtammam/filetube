sub init()
    m.grid = m.top.FindNode("grid")
    m.countLabel = m.top.FindNode("countLabel")
    m.emptyLabel = m.top.FindNode("emptyLabel")
    m.grid.ObserveField("itemSelected", "onItemSelected")
    m.grid.ObserveField("itemFocused", "onItemFocused")
    m.pageSize = 60
    m.total = 0
    m.loading = false
end sub

sub onBegin()
    if not m.top.begin then return
    m.total = 0
    m.loading = false
    m.emptyLabel.visible = false
    m.countLabel.text = "Loading…"
    m.contentRoot = CreateObject("roSGNode", "ContentNode")
    m.grid.content = m.contentRoot
    fetchPage(0)
    m.grid.SetFocus(true)
end sub

sub fetchPage(offset as integer)
    if m.loading then return
    m.loading = true
    m.task = CreateObject("roSGNode", "VideosTask")
    m.task.serverUrl = m.top.serverUrl
    m.task.cookie = m.top.cookie
    m.task.offset = offset
    m.task.limit = m.pageSize
    m.task.ObserveField("result", "onPageResult")
    m.task.control = "RUN"
end sub

sub onPageResult()
    m.loading = false
    result = m.task.result
    if result = invalid then return

    if result.ok <> true
        if result.code <> invalid and result.code = 401
            m.top.authExpired = true
        else
            m.top.loadError = result.error
        end if
        return
    end if

    m.total = result.total
    for each item in result.items
        m.contentRoot.AppendChild(buildContentNode(item))
    end for

    shown = m.contentRoot.GetChildCount()
    m.countLabel.text = shown.ToStr() + " of " + m.total.ToStr() + " videos · newest first"
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
        ftExt: ""
    })
    if item.id <> invalid then node.ftId = item.id
    if item.title <> invalid then node.title = item.title
    if item.ext <> invalid then node.ftExt = LCase(item.ext)
    if item.duration <> invalid
        node.ftDuration = item.duration
        node.ftDurationText = FT_FormatDuration(item.duration)
    end if
    if item.progress <> invalid then node.ftProgress = item.progress
    node.ftNeedsTranscode = (item.needsTranscode = true)
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
