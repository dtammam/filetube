sub init()
    m.top.functionName = "taskMain"
end sub

' GET /api/videos/:id — fetched lazily when the playback menu opens, because
' the LIST endpoint doesn't carry chapters. Only the chapter array is
' extracted; entries are normalized to { title, start } with defensive
' parsing (server chapters carry start seconds + title).
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/videos/" + m.top.itemId)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("Cookie", m.top.cookie)
    xfer.RetainBodyOnError(true)

    if not xfer.AsyncGetToString()
        m.top.result = { ok: false, itemId: m.top.itemId }
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
        m.top.result = { ok: false, itemId: m.top.itemId }
        return
    end if

    if ev.GetResponseCode() <> 200
        m.top.result = { ok: false, itemId: m.top.itemId }
        return
    end if

    parsed = ParseJson(ev.GetString())
    chapters = []
    if type(parsed) = "roAssociativeArray" and type(parsed.chapters) = "roArray"
        n = 0
        for each ch in parsed.chapters
            if type(ch) = "roAssociativeArray"
                startSec = invalid
                if ch.start <> invalid then startSec = ch.start
                if startSec = invalid and ch.time <> invalid then startSec = ch.time
                if startSec <> invalid and GetInterface(startSec, "ifInt") = invalid and GetInterface(startSec, "ifFloat") = invalid and GetInterface(startSec, "ifDouble") = invalid
                    startSec = invalid ' non-numeric start: skip the entry
                end if
                if startSec <> invalid
                    n = n + 1
                    title = ""
                    if GetInterface(ch.title, "ifString") <> invalid then title = ch.title
                    if title = "" then title = "Chapter " + n.ToStr()
                    chapters.Push({ title: title, start: startSec })
                end if
            end if
        end for
    end if
    m.top.result = { ok: true, itemId: m.top.itemId, chapters: chapters }
end sub
