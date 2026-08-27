sub init()
    m.poster = m.top.FindNode("poster")
    m.titleLabel = m.top.FindNode("titleLabel")
    m.metaLabel = m.top.FindNode("metaLabel")
end sub

sub onContentChange()
    content = m.top.itemContent
    if content = invalid then return
    m.poster.uri = content.HDPosterUrl
    m.titleLabel.text = content.title
    m.metaLabel.text = content.ftDurationText
end sub
