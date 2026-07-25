sub init()
    m.poster = m.top.FindNode("poster")
    m.titleLabel = m.top.FindNode("titleLabel")
    m.durLabel = m.top.FindNode("durLabel")
end sub

sub onContentChange()
    content = m.top.itemContent
    if content = invalid then return
    m.poster.uri = content.HDPosterUrl
    m.titleLabel.text = content.title
    m.durLabel.text = content.ftDurationText
end sub
