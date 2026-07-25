sub init()
    m.menu = m.top.FindNode("menu")
    m.hintLabel = m.top.FindNode("hintLabel")
    m.menu.ObserveField("itemSelected", "onMenuSelected")

    saved = FT_RegistryRead()
    m.form = {
        server: saved.serverUrl,
        username: saved.username,
        password: ""
    }
    m.editingField = ""
    refreshMenu()
end sub

sub onTakeFocus()
    m.menu.SetFocus(true)
end sub

sub refreshMenu()
    labels = [
        "Server:  " + displayOr(m.form.server, "http://…"),
        "Username:  " + displayOr(m.form.username, "—"),
        "Password:  " + displayOr(String(Len(m.form.password), "*"), "—"),
        "Sign in"
    ]
    content = CreateObject("roSGNode", "ContentNode")
    for each text in labels
        row = content.CreateChild("ContentNode")
        row.title = text
    end for
    focused = m.menu.itemFocused
    m.menu.content = content
    if focused > 0 then m.menu.jumpToItem = focused
end sub

function displayOr(value as string, fallback as string) as string
    if value = "" then return fallback
    return value
end function

sub onMenuSelected()
    index = m.menu.itemSelected
    if index = 0
        openKeyboard("server", "Server address (e.g. http://192.168.1.10:3000)", m.form.server, false)
    else if index = 1
        openKeyboard("username", "Username", m.form.username, false)
    else if index = 2
        openKeyboard("password", "Password", m.form.password, true)
    else if index = 3
        submit()
    end if
end sub

sub openKeyboard(field as string, title as string, current as string, secure as boolean)
    m.editingField = field
    kb = CreateObject("roSGNode", "KeyboardDialog")
    kb.title = title
    kb.text = current
    kb.buttons = ["OK", "Cancel"]
    ' Mask password entry when the firmware exposes the inner keyboard node.
    if secure and kb.keyboard <> invalid and kb.keyboard.textEditBox <> invalid
        kb.keyboard.textEditBox.secureMode = true
    end if
    kb.ObserveField("buttonSelected", "onKeyboardButton")
    m.kb = kb
    m.top.GetScene().dialog = kb
end sub

sub onKeyboardButton()
    if m.kb = invalid then return
    if m.kb.buttonSelected = 0
        m.form[m.editingField] = m.kb.text.Trim()
        refreshMenu()
    end if
    m.kb.close = true
    m.kb = invalid
end sub

sub submit()
    serverUrl = FT_NormalizeServerUrl(m.form.server)
    if serverUrl = "" or m.form.username = "" or m.form.password = ""
        m.hintLabel.visible = true
        return
    end if
    m.hintLabel.visible = false
    m.top.credentials = {
        serverUrl: serverUrl,
        username: m.form.username,
        password: m.form.password
    }
end sub
