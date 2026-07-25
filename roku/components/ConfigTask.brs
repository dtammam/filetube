sub init()
    m.top.functionName = "taskMain"
end sub

' GET /api/config — the configured library root folders, for the Libraries
' picker. Roots are filtered by the hidden flag and labeled with the
' operator's display name when one is set.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/config")
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

    if ev.GetResponseCode() <> 200
        m.top.result = { ok: false, error: "Config request failed." }
        return
    end if

    parsed = ParseJson(ev.GetString())
    if type(parsed) <> "roAssociativeArray" or type(parsed.folders) <> "roArray"
        m.top.result = { ok: false, error: "Unreadable config response." }
        return
    end if

    roots = []
    for each folderPath in parsed.folders
        if GetInterface(folderPath, "ifString") <> invalid
            entry = { name: baseName(folderPath), root: folderPath }
            settings = invalid
            if type(parsed.folderSettings) = "roAssociativeArray"
                settings = parsed.folderSettings[folderPath]
            end if
            if type(settings) = "roAssociativeArray"
                if settings.hidden = true then entry = invalid
                if entry <> invalid and GetInterface(settings.name, "ifString") <> invalid and settings.name <> ""
                    entry.name = settings.name
                end if
            end if
            if entry <> invalid then roots.Push(entry)
        end if
    end for
    m.top.result = { ok: true, roots: roots }
end sub

function baseName(p as string) as string
    parts = p.Split("/")
    for i = parts.Count() - 1 to 0 step -1
        if parts[i] <> "" then return parts[i]
    end for
    return p
end function
