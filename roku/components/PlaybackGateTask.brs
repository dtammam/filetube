sub init()
    m.top.functionName = "taskMain"
end sub

' Pre-flight the stream URL before the Video node ever sees it, so playback
' is SEAMLESS when the server is building a rendition (roku-compat remux,
' rotation bake, or a classic AVI transcode): 503 {error:"transcoding"} means
' "keep waiting", so poll until the file is ready instead of surfacing an
' error dialog and making the user press OK again. AppScene cancels this
' task (control=STOP) when the user backs out.
sub taskMain()
    clock = CreateObject("roTimespan")
    deadlineMs = 10 * 60 * 1000 ' rotate re-encodes of long videos take minutes
    while true
        probe = probeOnce()
        code = probe.code
        if code = 200 or code = 206
            m.top.result = { ok: true }
            return
        end if
        if code = 401
            m.top.result = { ok: false, error: "Your session expired. Please sign in again." }
            return
        end if
        if code <> 503
            if code < 0
                m.top.result = { ok: false, error: "Could not reach the server (network error " + code.ToStr() + ")." }
            else
                m.top.result = { ok: false, error: "Server replied with HTTP " + code.ToStr() + "." }
            end if
            return
        end if
        ' Gate W3: a permanently-failed conversion 503s FOREVER with
        ' status "failed" -- terminal, not "keep waiting". Without this a
        ' broken file meant ten minutes of "Preparing..." before a lie.
        if probe.status = "failed"
            m.top.result = { ok: false, error: "The server could not convert this file for streaming (its last attempt failed)." }
            return
        end if
        if clock.TotalMilliseconds() > deadlineMs
            m.top.result = { ok: false, error: "The server is still preparing this video. Give it a few minutes and try again." }
            return
        end if
        sleep(2000)
    end while
end sub

' One cheap readiness check: a 2-byte Range GET -> { code, status }. Ready
' files answer 206 (or 200); an in-flight rendition/transcode answers 503
' whose JSON body carries the transcode status ("failed" = terminal).
function probeOnce() as object
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("Cookie", m.top.cookie)
    xfer.AddHeader("Range", "bytes=0-1")
    xfer.RetainBodyOnError(true)
    if not xfer.AsyncGetToString() then return { code: -1, status: "" }
    clock = CreateObject("roTimespan")
    while clock.TotalMilliseconds() < 15000
        ev = wait(1000, port)
        if type(ev) = "roUrlEvent"
            status = ""
            body = ev.GetString()
            if body <> invalid and body <> ""
                parsed = ParseJson(body)
                if type(parsed) = "roAssociativeArray" and GetInterface(parsed.status, "ifString") <> invalid
                    status = parsed.status
                end if
            end if
            return { code: ev.GetResponseCode(), status: status }
        end if
    end while
    xfer.AsyncCancel()
    return { code: -1, status: "" }
end function
