' Shared helpers: registry persistence, URL normalization, formatting.

' Registry keys are all-lowercase ON PURPOSE: BrightScript lowercases AA keys
' set via literals/dot notation, while the Roku registry is case-sensitive.
' A mixed-case key here writes as "serverurl" but reads as "serverUrl" — the
' on-device bug where the server address never persisted across launches.
function FT_RegistryRead() as object
    sec = CreateObject("roRegistrySection", "FileTube")
    state = {}
    for each key in ["serverurl", "cookie", "username"]
        if sec.Exists(key)
            state[key] = sec.Read(key)
        else
            state[key] = ""
        end if
    end for
    return state
end function

sub FT_RegistryWrite(state as object)
    sec = CreateObject("roRegistrySection", "FileTube")
    for each key in state
        sec.Write(LCase(key), state[key])
    end for
    sec.Flush()
end sub

sub FT_RegistryClearSession()
    sec = CreateObject("roRegistrySection", "FileTube")
    if sec.Exists("cookie") then sec.Delete("cookie")
    sec.Flush()
end sub

' Normalize what the user typed into "http://host[:port]" with no trailing slash.
function FT_NormalizeServerUrl(raw as string) as string
    url = raw.Trim()
    if url = "" then return ""
    if Left(url, 7) <> "http://" and Left(url, 8) <> "https://"
        url = "http://" + url
    end if
    while Right(url, 1) = "/"
        url = Left(url, Len(url) - 1)
    end while
    return url
end function

' Seconds -> "H:MM:SS" or "M:SS".
function FT_FormatDuration(totalSeconds as dynamic) as string
    if totalSeconds = invalid then return ""
    secs = Int(totalSeconds)
    if secs <= 0 then return ""
    h = Int(secs / 3600)
    m = Int((secs mod 3600) / 60)
    s = secs mod 60
    if h > 0
        return h.ToStr() + ":" + FT_Pad2(m) + ":" + FT_Pad2(s)
    end if
    return m.ToStr() + ":" + FT_Pad2(s)
end function

function FT_Pad2(n as integer) as string
    if n < 10 then return "0" + n.ToStr()
    return n.ToStr()
end function
