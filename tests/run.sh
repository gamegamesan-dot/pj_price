#!/bin/sh
# 確認用テストをまとめて実行する。
#   sh tests/run.sh            … すべて
#   sh tests/run.sh review     … 名前に review を含むものだけ
# *.mjs は Worker（Node＋node:sqlite）、*.js は pj_price（実ブラウザ）。
# 1本でも ❌ があれば終了コードは 1。各テストは最後に
# 「RESULT <✅の数> <❌の数> <題>」を出すので、それを読んで集計する。
cd "$(dirname "$0")/.." || exit 1
FILTER="$1"
fail=0
run() {
  name=$(basename "$1")
  case "$name" in lib.js|lib.mjs) return 0;; esac
  if [ -n "$FILTER" ]; then
    case "$name" in *"$FILTER"*) ;; *) return 0;; esac
  fi
  out=$(node --disable-warning=ExperimentalWarning "$1" 2>&1)
  line=$(printf '%s\n' "$out" | grep '^RESULT ' | tail -1)
  if [ -z "$line" ]; then
    fail=1
    printf '%-16s 途中で止まりました\n' "$name"
    printf '%s\n' "$out" | tail -20 | sed 's/^/    /'
    return 0
  fi
  oks=$(printf '%s' "$line" | cut -d' ' -f2)
  ngs=$(printf '%s' "$line" | cut -d' ' -f3)
  if [ "$ngs" -gt 0 ]; then
    fail=1
    printf '%-16s ❌%-3s ✅%-4s\n' "$name" "$ngs" "$oks"
    printf '%s\n' "$out" | grep -B2 '❌' | sed 's/^/    /'
  else
    printf '%-16s ✅%-4s\n' "$name" "$oks"
  fi
}
echo '=== Worker（Node） ==='
for f in tests/*.mjs; do [ -e "$f" ] && run "$f"; done
echo '=== pj_price（実ブラウザ） ==='
for f in tests/*.js; do [ -e "$f" ] && run "$f"; done
if [ "$fail" -eq 0 ]; then echo '--- すべて通りました ---'; else echo '--- ❌ があります ---'; fi
exit "$fail"
