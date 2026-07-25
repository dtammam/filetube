sub init()
    m.top.functionName = "taskMain"
end sub

' Fire-and-forget pre-warm of the NEXT queue item (v1.47.1): one 2-byte
' Range GET at its ?compat=roku URL. A 503 answer means the server just
' started building the rendition in the background -- by the time autoplay
' or a Next press arrives, it's usually ready. DELIBERATELY one single
' request, no retry, no polling, and only ever for queueIndex+1: pre-warming
' must never cascade into processing the whole library.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("Cookie", m.top.cookie)
    xfer.AddHeader("Range", "bytes=0-1")
    if not xfer.AsyncGetToString() then return
    wait(10000, port) ' collect (and discard) the answer, then exit
end sub
