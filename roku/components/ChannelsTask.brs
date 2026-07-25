sub init()
    m.top.functionName = "taskMain"
end sub

' GET /api/channels — the grouped channel list (v1.47 server endpoint):
' folder (the ?folder= filter identity), display name, avatar URL, count.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    url = m.top.serverUrl + "/api/channels"
    if m.top.root <> ""
        url = url + "?root=" + xfer.Escape(m.top.root)
    end if
    xfer.SetUrl(url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("Cookie", m.top.cookie)
    xfer.RetainBodyOnError(true)

    if not xfer.AsyncGetToString()
        m.top.result = { ok: false, error: "Could not start the request." }
        return
    end if

    clock = CreateObject("roTimespan")
    ev = invalid
    while clock.TotalMilliseconds() < 15000
        msg = wait(1000, port)
        if type(msg) = "roUrlEvent"
            ev = msg
            exit while
        end if
    end while
    if ev = invalid
        xfer.AsyncCancel()
        m.top.result = { ok: false, error: "The server did not respond." }
        return
    end if

    code = ev.GetResponseCode()
    if code <> 200
        m.top.result = { ok: false, code: code, error: "Channels request failed (HTTP " + code.ToStr() + ")." }
        return
    end if

    parsed = ParseJson(ev.GetString())
    if type(parsed) <> "roAssociativeArray" or type(parsed.channels) <> "roArray"
        m.top.result = { ok: false, error: "Unreadable channels response." }
        return
    end if

    channels = []
    for each ch in parsed.channels
        if type(ch) = "roAssociativeArray" and GetInterface(ch.folder, "ifString") <> invalid and ch.folder <> ""
            entry = { folder: ch.folder, name: ch.folder, avatarUrl: "", count: 0 }
            if GetInterface(ch.name, "ifString") <> invalid and ch.name <> "" then entry.name = ch.name
            if GetInterface(ch.avatarUrl, "ifString") <> invalid then entry.avatarUrl = ch.avatarUrl
            if ch.count <> invalid then entry.count = Int(ch.count)
            channels.Push(entry)
        end if
    end for
    m.top.result = { ok: true, channels: channels }
end sub
