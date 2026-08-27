sub init()
    m.top.functionName = "taskMain"
end sub

' GET /api/tv/{showId} — the season/episode tree for one show (v1.199). Each
' episode row carries what the playback queue needs: ext (demuxer choice),
' the codec-aware needsTranscode flag, and the REQUESTER's own resume position.
' A 404 means "gone or restricted" — mapped to ok:false + code so the screen
' can treat it as an empty view, never an oracle-y error dialog.
sub taskMain()
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetMessagePort(port)
    xfer.SetUrl(m.top.serverUrl + "/api/tv/" + xfer.Escape(m.top.showId))
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
        m.top.result = { ok: false, code: code, error: "Show request failed (HTTP " + code.ToStr() + ")." }
        return
    end if

    parsed = ParseJson(ev.GetString())
    if type(parsed) <> "roAssociativeArray" or type(parsed.seasons) <> "roArray"
        m.top.result = { ok: false, error: "Unreadable show response." }
        return
    end if

    name = m.top.showId
    if GetInterface(parsed.name, "ifString") <> invalid and parsed.name <> "" then name = parsed.name
    seasons = []
    for each s in parsed.seasons
        if type(s) = "roAssociativeArray" and type(s.episodes) = "roArray"
            season = { label: "Episodes", episodes: [] }
            if GetInterface(s.label, "ifString") <> invalid and s.label <> "" then season.label = s.label
            for each e in s.episodes
                if type(e) = "roAssociativeArray" and GetInterface(e.id, "ifString") <> invalid and e.id <> ""
                    ep = { id: e.id, seasonNum: -1, episodeNum: -1, title: "", durationSec: 0.0, ext: "", codecs: "", needsTranscode: false, progress: 0.0 }
                    if GetInterface(e.title, "ifString") <> invalid then ep.title = e.title
                    if GetInterface(e.ext, "ifString") <> invalid then ep.ext = LCase(e.ext)
                    ' Codec strings ride the rows so a playback error can name
                    ' them (the GridScreen buildContentNode diagnostic parity).
                    codecs = ""
                    if GetInterface(e.codec, "ifString") <> invalid then codecs = e.codec
                    if GetInterface(e.audioCodec, "ifString") <> invalid
                        if codecs <> "" then codecs = codecs + "/"
                        codecs = codecs + e.audioCodec
                    end if
                    ep.codecs = codecs
                    ' seasonNum/episodeNum can be JSON null (an Extras file with no
                    ' SxxEyy) — keep -1 so the tile builder knows to hide the code.
                    if type(e.seasonNum) = "roInteger" or type(e.seasonNum) = "roFloat" or type(e.seasonNum) = "Double" then ep.seasonNum = Int(e.seasonNum)
                    if type(e.episodeNum) = "roInteger" or type(e.episodeNum) = "roFloat" or type(e.episodeNum) = "Double" then ep.episodeNum = Int(e.episodeNum)
                    if e.durationSec <> invalid then ep.durationSec = e.durationSec
                    ep.needsTranscode = (e.needsTranscode = true)
                    if e.progress <> invalid then ep.progress = e.progress
                    season.episodes.Push(ep)
                end if
            end for
            if season.episodes.Count() > 0 then seasons.Push(season)
        end if
    end for
    m.top.result = { ok: true, showId: m.top.showId, name: name, seasons: seasons }
end sub
