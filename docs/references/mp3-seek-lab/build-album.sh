#!/bin/bash
# Builds the synthetic yt-dlp-shaped test album (album.mp3 + album.m4a) in the current dir.
# Needs an ffmpeg with libmp3lame: FF=/path/to/ffmpeg (e.g. pip install imageio-ffmpeg).
# The steps mirror yt-dlp's audio pipeline: FFmpegExtractAudio (libmp3lame -q:a 5, yt-dlp's
# default --audio-quality), FFmpegMetadata + --embed-chapters (stream copy), EmbedThumbnail.
set -euo pipefail
FF="${FF:-ffmpeg}"
songs=( "0.9:white:60" "0.15:brown:75" "0.6:pink:55" "0.05:white:80" "0.8:brown:65" "0.3:pink:70" )
inputs=(); fc=""; n=0; t=0; chap=";FFMETADATA1"$'\n'
add() { inputs+=(-f lavfi -t "$2" -i "$1"); fc+="[$n:a]"; n=$((n+1)); }
add "anoisesrc=a=0.3:c=pink:r=44100:seed=7" 20; t=20
i=0; for s in "${songs[@]}"; do IFS=: read -r a c d <<<"$s"; add "anullsrc=r=44100:cl=mono" 3; t=$((t+3)); chap+="[CHAPTER]"$'\n'"TIMEBASE=1/1000"$'\n'"START=$((t*1000))"$'\n'"END=$(((t+d)*1000))"$'\n'"title=Song $((i+1))"$'\n'; add "anoisesrc=a=$a:c=$c:r=44100:seed=$((i+11))" "$d"; t=$((t+d)); i=$((i+1)); done
printf '%s' "$chap" > chapters.txt
"$FF" -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "${fc}concat=n=$n:v=0:a=1,aformat=channel_layouts=stereo[o]" -map "[o]" src.wav
"$FF" -hide_banner -loglevel error -y -i src.wav -vn -c:a libmp3lame -q:a 5 step1.mp3
"$FF" -hide_banner -loglevel error -y -i step1.mp3 -i chapters.txt -map 0 -map_metadata 1 -map_chapters 1 -c copy -id3v2_version 3 -write_id3v1 1 step2.mp3
"$FF" -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=1280x720" -frames:v 1 -q:v 2 cover.jpg
"$FF" -hide_banner -loglevel error -y -i step2.mp3 -i cover.jpg -map 0 -map 1 -c copy -id3v2_version 3 -write_id3v1 1 -disposition:v attached_pic album.mp3
"$FF" -hide_banner -loglevel error -y -i src.wav -c:a aac -b:a 128k -movflags +faststart album.m4a
echo "built album.mp3 + album.m4a (${t}s)"
