viz_main() {
  local out
  out=$(dirname "$(readlink -f "$SRC")")/preview.png
  render_png "$out"
  echo "preview: $out"
  if [ -n "$SAVE_AS" ]; then
    local slug filename dest
    slug=$(printf '%s' "$SAVE_AS" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
    [ -z "$slug" ] && slug=viz
    filename="viz-$slug-$(date +%s%3N).png"
    mkdir -p "$PWD/viz"
    dest=$PWD/viz/$filename
    cp "$out" "$dest"
    echo "filename: $filename"
    echo "path: $dest"
  fi
}

viz_parse_args() {
  SRC=${1:?usage: $(basename "$0") <source> [--save-as <slug>]}; shift
  SAVE_AS=""
  while [ $# -gt 0 ]; do
    case $1 in
      --save-as) SAVE_AS=${2:?--save-as needs a slug}; shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  [ -f "$SRC" ] || { echo "source not found: $SRC" >&2; exit 2; }
}
