sub init()
    m.top.functionName = "run"
end sub

sub run()
    if m.top.mode = "login"
        m.top.result = doLogin()
    else
        m.top.result = doValidate()
    end if
end sub

' POST /api/auth/login and harvest the session cookie (name is per-instance:
' ft_session_<hash>, so we take whatever cookie the server actually sets).
function doLogin() as object
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/auth/login")
    xfer.AddHeader("Content-Type", "application/json")
    xfer.RetainBodyOnError(true)
    xfer.EnableCookies()

    body = FormatJson({ username: m.top.username, password: m.top.password })
    if not xfer.AsyncPostFromString(body)
        return { ok: false, error: "Could not start the request." }
    end if

    ev = waitForUrlEvent(port, xfer, 20000)
    if ev = invalid then return { ok: false, error: "The server did not respond." }

    code = ev.GetResponseCode()
    if code = 200
        cookieHeader = extractSessionCookie(xfer)
        if cookieHeader = ""
            return { ok: false, error: "Signed in, but no session cookie was returned." }
        end if
        return { ok: true, cookie: cookieHeader }
    end if
    return { ok: false, code: code, error: httpErrorMessage(code, ev.GetString()) }
end function

' GET /api/auth/me with the stored cookie; 200 means the session is alive.
function doValidate() as object
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/auth/me")
    xfer.AddHeader("Cookie", m.top.cookie)
    xfer.RetainBodyOnError(true)

    if not xfer.AsyncGetToString()
        return { ok: false, error: "Could not start the request." }
    end if

    ev = waitForUrlEvent(port, xfer, 15000)
    if ev = invalid then return { ok: false, error: "The server did not respond." }

    code = ev.GetResponseCode()
    if code = 200 then return { ok: true }
    return { ok: false, code: code, error: httpErrorMessage(code, ev.GetString()) }
end function

function extractSessionCookie(xfer as object) as string
    cookies = xfer.GetCookies("", "/")
    if cookies = invalid then return ""
    for each c in cookies
        if c.name <> invalid and Left(c.name, 10) = "ft_session"
            return c.name + "=" + c.value
        end if
    end for
    return ""
end function

function waitForUrlEvent(port as object, xfer as object, timeoutMs as integer) as dynamic
    clock = CreateObject("roTimespan")
    while clock.TotalMilliseconds() < timeoutMs
        ev = wait(1000, port)
        if type(ev) = "roUrlEvent" then return ev
    end while
    xfer.AsyncCancel()
    return invalid
end function

function httpErrorMessage(code as integer, bodyText as dynamic) as string
    ' FileTube error bodies are JSON: { "error": "..." }
    if bodyText <> invalid and bodyText <> ""
        parsed = ParseJson(bodyText)
        if parsed <> invalid and parsed.error <> invalid and parsed.error <> ""
            return parsed.error
        end if
    end if
    if code < 0 then return "Could not reach the server (network error " + code.ToStr() + ")."
    return "Server replied with HTTP " + code.ToStr() + "."
end function
