sub init()
    m.top.functionName = "taskMain"
end sub

' Fire-and-forget watch-progress write-back (v1.47.1): the SAME ping the web
' player sends -- POST /api/progress {id, timestamp, duration} -- so resume
' positions stay in sync across the TV, web, and phone. Failures are
' silently dropped: progress sync must never interrupt playback.
'
' v1.199: episodes ride the same task. `endpoint` points the ping at
' /api/tv/progress (identical body, the tv keyspace), and mode="tvplayed"
' posts the completion watched-latch (POST /api/tv/played {episodeId}) in
' place of a progress body.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    if m.top.mode = "tvplayed"
        xfer.SetUrl(m.top.serverUrl + "/api/tv/played")
        body = FormatJson({ episodeId: m.top.itemId })
    else
        endpoint = m.top.endpoint
        if endpoint = "" then endpoint = "/api/progress"
        xfer.SetUrl(m.top.serverUrl + endpoint)
        body = FormatJson({ id: m.top.itemId, timestamp: m.top.position, duration: m.top.duration })
    end if
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("Content-Type", "application/json")
    xfer.AddHeader("Cookie", m.top.cookie)
    if not xfer.AsyncPostFromString(body) then return
    wait(10000, port) ' collect (and discard) the answer, then exit
end sub
