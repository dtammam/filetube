sub init()
    m.top.functionName = "taskMain"
end sub

' GET /api/tv — the shows grid (v1.199): id (the detail-route identity), display
' name, season/episode counts. Visibility-filtered server-side, so an empty
' array is the honest answer for a fully-restricted member.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/tv")
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
        m.top.result = { ok: false, code: code, error: "Shows request failed (HTTP " + code.ToStr() + ")." }
        return
    end if

    parsed = ParseJson(ev.GetString())
    if type(parsed) <> "roAssociativeArray" or type(parsed.shows) <> "roArray"
        m.top.result = { ok: false, error: "Unreadable shows response." }
        return
    end if

    shows = []
    for each sh in parsed.shows
        if type(sh) = "roAssociativeArray" and GetInterface(sh.id, "ifString") <> invalid and sh.id <> ""
            entry = { id: sh.id, name: sh.id, seasonCount: 0, episodeCount: 0 }
            if GetInterface(sh.name, "ifString") <> invalid and sh.name <> "" then entry.name = sh.name
            if sh.seasonCount <> invalid then entry.seasonCount = Int(sh.seasonCount)
            if sh.episodeCount <> invalid then entry.episodeCount = Int(sh.episodeCount)
            shows.Push(entry)
        end if
    end for
    m.top.result = { ok: true, shows: shows }
end sub
