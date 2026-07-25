sub init()
    m.tileBg = m.top.FindNode("tileBg")
    m.initialLabel = m.top.FindNode("initialLabel")
    m.avatar = m.top.FindNode("avatar")
    m.nameLabel = m.top.FindNode("nameLabel")
    m.countLabel = m.top.FindNode("countLabel")
    ' SECURITY (gate C1): channel avatars are REMOTE URLs (yt CDN). Per the
    ' roHttpAgent docs, ifHttpAgent calls on a node do NOT mint a local
    ' agent -- isolation requires an EXPLICIT new roHttpAgent assigned via
    ' setHttpAgent. Without it this Poster would inherit the scene agent
    ' and send the FileTube session cookie to third-party hosts. GridItem's
    ' posters keep the inherited agent because /thumbnail/:id NEEDS it.
    agent = CreateObject("roHttpAgent")
    agent.AddHeader("Accept", "image/*")
    m.avatar.setHttpAgent(agent)
end sub

sub onContentChange()
    content = m.top.itemContent
    if content = invalid then return
    name = content.title
    m.nameLabel.text = name
    m.countLabel.text = content.ftDurationText
    m.tileBg.color = colorForName(name)
    if name <> ""
        m.initialLabel.text = UCase(Left(name, 1))
    else
        m.initialLabel.text = "?"
    end if
    ' Gate W6: the avatar rides a CUSTOM field, never HDPosterUrl -- so no
    ' scene-agent consumer (e.g. GridItem, if a firmware ignored the
    ' itemComponentName swap) can ever fetch the remote URL with the cookie.
    m.avatar.uri = content.ftAvatarUrl ' "" when no avatar: fallback shows
end sub

' Deterministic tile color from the channel name (mirrors the web UI's
' generated-avatar idea): same name, same color, every render.
function colorForName(name as string) as string
    palette = ["0x8E44ADFF", "0x2980B9FF", "0x16A085FF", "0xD35400FF", "0xC0392BFF", "0x27AE60FF", "0x2C3E50FF", "0x7F8C8DFF"]
    sum = 0
    for i = 1 to Len(name)
        sum = sum + Asc(Mid(name, i, 1))
    end for
    return palette[sum mod palette.Count()]
end function
