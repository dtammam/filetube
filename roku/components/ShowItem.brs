sub init()
    m.poster = m.top.FindNode("poster")
    m.titleLabel = m.top.FindNode("titleLabel")
    m.metaTop = m.top.FindNode("metaTop")
    m.metaBottom = m.top.FindNode("metaBottom")
end sub

sub onContentChange()
    content = m.top.itemContent
    if content = invalid then return
    m.poster.uri = content.HDPosterUrl
    m.titleLabel.text = content.title
    ' Two stacked count lines (shows: "N seasons" + "M episodes"; seasons wall:
    ' just "M episodes" with an empty bottom -> hidden). Non-existent fields read
    ' back invalid on a bare ContentNode, so coerce to "" before assigning text.
    top = content.ftMetaTop
    if top = invalid then top = ""
    m.metaTop.text = top
    bottom = content.ftMetaBottom
    if bottom = invalid then bottom = ""
    m.metaBottom.text = bottom
    m.metaBottom.visible = (bottom <> "")
end sub
