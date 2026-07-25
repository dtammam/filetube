sub init()
    m.top.functionName = "taskMain"
end sub

' GET /api/videos?sort=newest — one page of the library, newest first.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    url = m.top.serverUrl + "/api/videos?sort=newest"
    url = url + "&limit=" + m.top.limit.ToStr() + "&offset=" + m.top.offset.ToStr()
    if m.top.root <> ""
        url = url + "&root=" + xfer.Escape(m.top.root)
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
    while clock.TotalMilliseconds() < 20000
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
        m.top.result = { ok: false, code: code, error: "Library request failed (HTTP " + code.ToStr() + ")." }
        return
    end if

    parsed = ParseJson(ev.GetString())
    if type(parsed) <> "roAssociativeArray" or type(parsed.items) <> "roArray"
        m.top.result = { ok: false, error: "The server sent an unreadable library response." }
        return
    end if

    ' Pass through only what the UI needs — keeps the field copy small.
    items = []
    for each it in parsed.items
        entry = {
            id: it.id,
            title: it.title,
            duration: it.duration,
            progress: it.progress,
            needsTranscode: it.needsTranscode = true,
            hasThumbnail: it.hasThumbnail = true,
            hasSubtitles: it.hasSubtitles = true,
            mediaType: it.type,
            ext: it.ext,
            videoCodec: it.videoCodec,
            audioCodec: it.audioCodec
        }
        if entry.title = invalid or entry.title = "" then entry.title = it.name
        items.Push(entry)
    end for

    total = 0
    if parsed.total <> invalid then total = Int(parsed.total)
    m.top.result = { ok: true, items: items, total: total, offset: m.top.offset }
end sub
