sub init()
    m.top.functionName = "taskMain"
end sub

' Fire-and-forget watch-progress write-back (v1.47.1): the SAME ping the web
' player sends -- POST /api/progress {id, timestamp, duration} -- so resume
' positions stay in sync across the TV, web, and phone. Failures are
' silently dropped: progress sync must never interrupt playback.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/progress")
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("Content-Type", "application/json")
    xfer.AddHeader("Cookie", m.top.cookie)
    body = FormatJson({ id: m.top.itemId, timestamp: m.top.position, duration: m.top.duration })
    if not xfer.AsyncPostFromString(body) then return
    wait(10000, port) ' collect (and discard) the answer, then exit
end sub
