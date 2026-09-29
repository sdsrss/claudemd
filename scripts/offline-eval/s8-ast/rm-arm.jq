# rm-arm.jq — OFFLINE RESEARCH ONLY, not a gate. The §8 rm-rf-var rule of
# hooks/pre-bash-safety-check.sh, re-expressed over a shfmt --to-json AST
# (shfmt >= 3.14.0; see ast-rm.sh for the pinned binary and its sha256).
# scripts/offline-eval/s8-shadow.mjs compares its verdicts with the text gate.
#
# Input: the JSON of one script. Optional named arg `outer` (jq --argjson): the
# names a parent scan saw guarded with ${VAR:?}, for a `bash -c` / eval string.
# Output, one line per finding:
#   DENY\t<var>              an rm -r/-f (or find -delete / -exec rm) target
#                            whose leading expansion the rule does not credit
#   INNER\t<s:e>[,<s:e>…]    byte spans of a string a child shell or eval parses
#                            (joined with spaces); the driver re-parses it
#   GUARDS\t<json array>     names guarded here or above, handed to INNER scans
#
# Which commands: every CallExpr the shell would run, wherever it sits ($(...),
# subshells, function bodies, if/loop bodies), after the wrappers the gate
# strips (env, sudo, timeout …, with their option arguments) and a field split
# at unquoted $IFS. rm needs -r/-R/-f/-F/--recursive/--force before `--`; find
# needs -delete or -exec/-execdir rm, and its path operands are the targets.
# `bash|sh|zsh|dash|ksh|ash -…c`, su -c, ssh HOST and eval hand a string to a
# child parser: emitted as INNER, re-parsed by ast-rm.sh.
#
# The policy is the gate's, read from its source and deny text (fb8f834):
#   - a target is judged by its FIRST top-level expansion; later ones are read
#     as empty (the whitelist arm's own message: "the gate reads $X as empty"),
#     and an expansion inside $(...) is data (corpus pass row F7-fp,
#     `rm -rf "$(dirname $FOO)"`). Special parameters ($$ $! $@ …) never count;
#   - a `..` component in the target's literal residue denies, whatever bounds
#     the variable (expansions deleted, or a :- / - default substituted);
#   - HOME PWD OLDPWD TMPDIR (and a leading `~`) pass with a literal subpath,
#     never bare; a find with a selection primary is bounded;
#   - ${VAR:?…} anywhere in the script credits VAR, position-blind; ${VAR?}
#     does not (it passes an empty value);
#   - VAR=$(mktemp …) credits VAR when it certainly ran earlier in the same
#     shell (dominance, below), every binding of VAR is such an assignment,
#     nothing rebinds VAR (export/local/unset/read/printf -v/for/…, or any of
#     them on a name the text does not spell), no eval/source/. command, IFS
#     assignment or opaque DEBUG trap runs anywhere, the rm names no other
#     variable, and the target holds no `..`.
# Not modelled: xargs stdin targets, literal-assignment provenance (the gate
# does not credit it either), `..` supplied by another variable's value.
# Positional parameters ($1 …) are judged like any variable; the gate skips
# `$1` and judges `${1}` — an open question, tasks/s8-ast-shadow/adjudication.md.
#
# Research knob, `ablate` (jq --argjson, via S8_AST_ABLATE in ast-rm.sh): a list
# of pieces to switch back to the r1 prototype-v6 behaviour, to measure what
# each piece moves on real commands. Pieces: syntax, whitelist, dotdot,
# firstvar, colon, provrules, provquote, funcall, outer (knobs: in ast-rm.sh).
# Empty by default; nothing a verdict should depend on.

def wlit:            # literal value of a word, or null when any part is dynamic
  if (.Parts // null) == null then null
  else [ .Parts[] |
         if .Type == "Lit" then .Value
         elif .Type == "SglQuoted" then .Value
         elif .Type == "DblQuoted" then
           ( [ (.Parts // [])[] | if .Type == "Lit" then .Value else null end ] as $p
             | if any($p[]; . == null) then null else ($p | join("")) end )
         else null end ]
       | if any(.[]; . == null) then null else join("") end
  end;

def basename: sub("^.*/"; "") | sub("^\\\\"; "");
def abl($piece): (($ARGS.named.ablate // []) | index($piece)) != null;

# Special parameters are never a "variable target": $$ $! $# $? $- $@ $* $0.
def special: IN("$", "!", "#", "?", "-", "@", "*", "0");

def no_mods: (.Index == null) and ((.Length // false) | not) and ((.Excl // false) | not)
  and ((.Width // false) | not) and (.Slice == null) and (.Repl == null) and (.Names == null);
def op: .Exp.Op // "";
def is_guard: no_mods and (op == ":?" or (abl("colon") and op == "?"));

# ParamExps a word expands at top level, in order (not those inside $(...),
# $((...)) or another expansion's operand: the gate reads those as data).
def top_pexps: [ (.Parts // [])[]
  | if .Type == "ParamExp" then .
    elif .Type == "DblQuoted" then (.Parts // [])[] | select(.Type == "ParamExp")
    else empty end ];

# Literal residue of a word. $defaults=false deletes every expansion (the
# gate's empty-expansion reading); true substitutes a literal :- / - / := / =
# default, the value an empty variable actually takes.
def ptext($defaults; $dq):
  if .Type == "Lit" then
    (if $dq then .Value | gsub("\\\\(?<c>[$`\"\\\\])"; "\(.c)") else .Value | gsub("\\\\(?<c>.)"; "\(.c)") end)
  elif .Type == "SglQuoted" then .Value
  elif .Type == "DblQuoted" then [ (.Parts // [])[] | ptext($defaults; true) ] | join("")
  elif .Type == "ParamExp" and $defaults and (op | IN(":-", "-", ":=", "=")) then (.Exp.Word | wlit // "")
  else "" end;
def residue($defaults): [ (.Parts // [])[] | ptext($defaults; false) ] | join("");
def dotdot: ("/" + . + "/") | test("/\\.\\./");

# Split a word at unquoted $IFS / ${IFS}: bash field-splits there, so
# `rm${IFS}-rf${IFS}$X` is three words.
def ifs_split:
  if (abl("syntax") | not) and any((.Parts // [])[]; .Type == "ParamExp" and .Param.Value == "IFS" and no_mods and .Exp == null) then
    reduce .Parts[] as $p ([[]];
      if $p.Type == "ParamExp" and $p.Param.Value == "IFS" and ($p | no_mods) and $p.Exp == null
      then . + [[]] else .[:-1] + [.[-1] + [$p]] end)
    | map(select(length > 0) | {Parts: ., Pos: .[0].Pos, End: .[-1].End})[]
  else . end;

# Wrappers the gate strips before the command word (s8_strip_wrappers), with the
# options that take a separate argument (s8_wrap_optarg).
def optarg($w; $f):
  if abl("syntax") then false
  elif $w == "env" then $f | IN("-u", "-S", "-C", "--unset", "--split-string", "--chdir")
  elif $w == "exec" then $f == "-a"
  elif $w == "time" then $f | IN("-o", "-f", "--output", "--format")
  elif $w == "timeout" then $f | IN("-s", "-k", "--signal", "--kill-after")
  elif $w == "stdbuf" then $f | IN("-i", "-o", "-e", "--input", "--output", "--error")
  elif $w == "sudo" then $f | IN("-u", "-g", "-U", "-C", "-p", "-D", "-r", "-t", "-h", "--user", "--group",
    "--other-user", "--close-from", "--prompt", "--chdir", "--role", "--type", "--host")
  elif $w == "doas" then $f | IN("-u", "-C")
  else false end;
def consume($w; $dur):
  if length == 0 then .
  else (.[0] | wlit // "") as $t
  | if ($t | startswith("-")) then (if optarg($w; $t) then .[2:] else .[1:] end) | consume($w; $dur)
    elif $dur and ($t | test("^[0-9]+[smhd]?$")) then .[1:] | consume($w; $dur)
    elif ($t | test("^[A-Za-z_][A-Za-z0-9_]*=")) then .[1:] | consume($w; $dur)
    else . end
  end;
def strip_wrappers:  # args array -> args array starting at the real command word
  if length == 0 then .
  else (.[0] | wlit // "" | basename) as $w
  | if ($w | IN("env", "command", "builtin", "exec", "nohup", "setsid", "time", "busybox")) then .[1:] | consume($w; false) | strip_wrappers
    elif ($w | IN("timeout", "nice", "stdbuf", "ionice", "chrt", "sudo", "doas")) then .[1:] | consume($w; true) | strip_wrappers
    else . end
  end;
def cmd_args: [ (.Args // [])[] | ifs_split ] | strip_wrappers;
def cmd_name: if length == 0 then "" else .[0] | wlit // "" | basename end;

# ---- mktemp provenance -----------------------------------------------------
# A statement whose output can only come from mktemp: a mktemp call, or an
# && / || chain of them (`$(mktemp -d X 2>/dev/null || mktemp -d)`).
def mk_stmt:
  if .Cmd.Type == "CallExpr" then ((.Cmd.Args // []) | strip_wrappers | cmd_name) == "mktemp"
  elif .Cmd.Type == "BinaryCmd" and (.Cmd.Op | IN("&&", "||")) then (.Cmd.X | mk_stmt) and (.Cmd.Y | mk_stmt)
  else false end;
def is_mktemp_value: (.Value.Parts // []) as $p
  | ($p | length) >= 1
    and ((if $p[0].Type == "DblQuoted" and (abl("provquote") | not) then ($p[0].Parts // [])[0] else $p[0] end) as $c
         | ($c.Type? == "CmdSubst") and (($c.Stmts // []) | length) > 0 and all($c.Stmts[]; mk_stmt));
def prefix_of($a; $b): ($a | length) <= ($b | length) and $b[0:($a | length)] == $a;

# Does the statement at path $s certainly run before the node at $pr, in the same
# shell? Credited: an earlier statement of an enclosing list, through { } groups
# and either side of && (the relaxed reading), the left of ||, and the body of a
# { }-bodied function whose call does. Never: a subshell, $(...), an if / loop /
# case body, a backgrounded statement, the right side of ||, or a later statement.
def dominates($root; $s; $pr; $d):
  if $d > 4 or ($s | length) < 1 then false
  elif ($s[-1] | type) == "number" then
    if ($root | getpath($s) | .Background // false) then false
    else ($s[:-1]) as $L
      | if prefix_of($L; $pr) and ($pr[$L | length] > $s[-1]) then true
        else ($L[:-1]) as $own
          | if ($own | length) == 0 then false
            elif ($root | getpath($own) | .Type) == "Block" then dominates($root; $own[:-1]; $pr; $d)
            else false end
        end
    end
  elif $s[-1] == "X" and ($root | getpath($s[:-1]) | .Type == "BinaryCmd" and (.Op | IN("&&", "||"))) then
    if ($root | getpath($s) | .Background // false) then false
    elif ($root | getpath($s[:-1]) | .Op) == "&&" and prefix_of($s[:-1] + ["Y"]; $pr) then true
    else dominates($root; $s[:-2]; $pr; $d) end
  elif $s[-1] == "Y" and ($root | getpath($s[:-1]) | .Type == "BinaryCmd" and .Op == "&&") then
    dominates($root; $s[:-2]; $pr; $d)
  elif (abl("funcall") | not) and $s[-1] == "Body" and ($root | getpath($s[:-1]) | .Type) == "FuncDecl"
       and ($root | getpath($s) | .Cmd.Type) == "Block" then
    ($root | getpath($s[:-1]) | .Name.Value) as $fn
    | any($root | paths(objects) as $p | ($root | getpath($p)) as $n
          | select($n.Type == "CallExpr" and (($n.Args // []) | strip_wrappers | cmd_name) == $fn)
          | $p[:-1];
          dominates($root; .; $pr; $d + 1))
  else false end;

# mktemp assignments: {n: name, s: path of the statement, decl: local/declare?}
def mk_assigns($root):
  [ $root | paths(objects) as $p | ($root | getpath($p)) as $n
    | if ($n.Type == "CallExpr") and ((($n.Args // []) | length) == 0) then
        ($n.Assigns // [])[] | select(is_mktemp_value and ((.Append // false) | not))
        | {n: .Name.Value, s: $p[:-1], decl: false}
      elif $n.Type == "DeclClause" then
        ($n.Variant.Value // "") as $v
        | ($n.Args // [])[] | select(.Name != null and ((.Naked // false) | not)) | select(is_mktemp_value)
        | {n: .Name.Value, s: $p[:-1], decl: ($v | IN("local", "declare", "typeset"))}
      else empty end ];

# Every binding of $v in the script is a plain mktemp assignment.
def only_mktemp_bindings($root; $v):
  all($root | .. | objects
      | if .Type == "CallExpr" then (.Assigns // [])[] | select(.Name.Value == $v)
        elif .Type == "DeclClause" then (.Args // [])[] | select(.Name.Value? == $v)
        else empty end;
      ((.Naked // false) | not) and ((.Append // false) | not) and is_mktemp_value);

# Something other than an assignment names $v in a position that can rebind it.
def names_var($v): (wlit // "") | test("^(-[A-Za-z]*)?" + $v + "(\\[.*\\])?(\\+?=.*)?$");
def dynamic: wlit == null;
def rebinds($root; $v):
  any($root | .. | objects;
      (.Type == "DeclClause" and any((.Args // [])[];
          (.Naked == true and .Name.Value? == $v) or ((.Value // null) != null and (.Value | wlit) == $v)))
      or (.Type == "CallExpr" and (((.Args // []) | strip_wrappers) as $a
          | ($a | cmd_name | IN("unset", "read", "mapfile", "readarray", "printf", "getopts", "let", "wait"))
            and any($a[1:][]; names_var($v))))
      or (.Type == "ForClause" and .Loop.Name.Value? == $v)
      or (.Type == "BinaryArithm" and (.Op | IN("=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="))
          and (.X | wlit) == $v)
      or (.Type == "UnaryArithm" and (.Op | IN("++", "--")) and (.X | wlit) == $v)
      # A name the text does not spell can be any name, $v included (S8-PROV19:
      # `unset ${x-S}`): unset / read / mapfile of a computed name, printf -v to
      # one, a declaration of one, or a nameref to one.
      or (.Type == "CallExpr" and (((.Args // []) | strip_wrappers) as $a
          | (($a | cmd_name | IN("unset", "read", "mapfile", "readarray"))
             and any($a[1:][]; dynamic))
            or (($a | cmd_name) == "printf"
                and any(range(1; ($a | length) - 1) as $i | select(($a[$i] | wlit) == "-v") | $a[$i + 1]; dynamic))))
      or (.Type == "DeclClause" and ((.Args // []) as $da
          | any($da[]; .Naked == true and .Name == null and (.Value | dynamic))
            or (any($da[]; .Naked == true and ((.Value | wlit // "") | test("^-[a-zA-Z]*n")))
                and any($da[]; .Name != null and (.Value // null) != null and (.Value | dynamic))))));

# A DEBUG / RETURN / ERR trap whose action the text does not spell runs before
# (or around) every command, the rm included (S8-PROV20).
def opaque_trap($root):
  any($root | .. | objects | select(.Type == "CallExpr") | (.Args // []) | strip_wrappers;
      cmd_name == "trap" and length >= 3 and (.[1] | dynamic)
      and any(.[2:][]; (wlit // "") | IN("DEBUG", "RETURN", "ERR")));

def runs_foreign_code($root):   # eval / source / . anywhere: code the scan cannot see
  any($root | .. | objects | select(.Type == "CallExpr"); (.Args // []) | strip_wrappers | cmd_name | IN("eval", "source", "."));
def binds_ifs($root):
  any($root | .. | objects
      | if .Type == "CallExpr" then (.Assigns // [])[] elif .Type == "DeclClause" then (.Args // [])[] else empty end;
      .Name.Value? == "IFS");

# ---- judging one target word ------------------------------------------------
# A leading unquoted `~` is $HOME (`~+` $PWD, `~-` $OLDPWD, `~user` another
# home): rewrite it as that expansion so the whitelist and `..` rules see it
# (R16 residuals: `rm -rf ~/../victim` is `rm -rf "$HOME/../victim"`).
def tilde:
  if (.Parts // [])[0].Type? == "Lit" and (.Parts[0].Value | test("^~[A-Za-z0-9_.+-]*(/|$)"))
  then (.Parts[0].Value | capture("^~(?<u>[A-Za-z0-9_.+-]*)(?<rest>.*)$")) as $t
    | .Parts = [{Type: "ParamExp", Short: true,
                 Param: {Value: (if $t.u == "+" then "PWD" elif $t.u == "-" then "OLDPWD" else "HOME" end)}},
                (.Parts[0] | .Value = $t.rest)] + .Parts[1:]
  else . end;

# $c: {root, pr, mk, guards, others, bounded, noprov}
def judge($c):
  (if abl("firstvar") then [ .. | objects | select(.Type == "ParamExp") ] else top_pexps end
   | map(select(.Param.Value | special | not))) as $ps
  | if ($ps | length) == 0 then empty
    else (if abl("firstvar") then $ps[] else $ps[0] end) as $p | $p.Param.Value as $v
    | residue(false) as $rd
    | if (abl("dotdot") | not) and (($rd | dotdot) or (residue(true) | dotdot)) then $v
      elif ($v | IN("HOME", "PWD", "OLDPWD", "TMPDIR")) and (abl("whitelist") or (($p | no_mods) and ($p | op | IN("", ":?", "?")))) then
        (if abl("whitelist") or ($rd | test("[^/]")) or $c.bounded then empty else $v end)
      elif ($c.guards | index($v)) != null then empty
      elif (abl("provrules")
            or (($c.noprov | not)
                and ($c.others - [$v] | length) == 0
                and ($rd | contains("..") | not)
                and ($p | no_mods) and ($p | op) == ""
                and only_mktemp_bindings($c.root; $v)
                and (rebinds($c.root; $v) | not)))
           and ($v | test("^[A-Za-z_][A-Za-z0-9_]*$"))
           and any($c.mk[]; .n == $v and dominates($c.root; .s; $c.pr; 0)
                   # a local/declare inside a function body credits only an rm in that body
                   and ((.s | indices("Body") | last) as $b
                        | if .decl and $b != null then prefix_of(.s[:$b + 1]; $c.pr) else true end))
      then empty
      else $v end
    end;

def ident_names: [ .. | objects | select(.Type == "ParamExp") | select((.Short // false) and (.Param.Value | test("^[0-9]")) | not)
  | .Param.Value | select(special | not) ] | unique;

# A shell / su / ssh / eval word list → INNER spans of the string it runs.
def span: "\(.Pos.Offset):\(.End.Offset)";
def inner_of:   # . = args array starting at the command word
  cmd_name as $w
  | if abl("syntax") then
      if ($w | IN("bash", "sh", "zsh", "dash")) then
        (map(wlit) | index("-c")) as $i | select($i != null) | .[$i + 1] | select(. != null) | span
      elif $w == "eval" then .[1:][] | span
      else empty end
    elif ($w | IN("bash", "sh", "zsh", "dash", "ksh", "ash")) then
      first(foreach .[1:][] as $a ({skip: false, take: false, done: false, out: null};
        if .done then . elif .take then {done: true, out: ($a | span)}
        elif .skip then .skip = false
        else ($a | wlit // "") as $t
          | if ($t | test("^-[A-Za-z]*c[A-Za-z]*$")) then .take = true
            elif ($t | IN("-o", "+o", "-O", "+O")) then .skip = true
            elif ($t | test("^[-+]")) then .
            else .done = true end
        end;
        select(.out != null) | .out)) // empty
    elif $w == "su" then
      (map(wlit // "") | index("-c")) as $i | select($i != null) | .[$i + 1] | select(. != null) | span
    elif $w == "ssh" then
      reduce .[1:][] as $a ({skip: false, host: false, out: []};
        if .skip then .skip = false
        elif .host then .out += [$a | span]
        else ($a | wlit // "") as $t
          | if ($t | test("^-[bcDEeFIiJLlmOopQRSWwB]$")) then .skip = true
            elif ($t | startswith("-")) then .
            else .host = true end
        end) | .out | select(length > 0) | join(",")
    elif $w == "eval" then
      .[1:] | select(length > 0) | map(span) | join(",")
    else empty end;

. as $root
| mk_assigns($root) as $mk
| (([ $root | .. | objects | select(.Type == "ParamExp") | select(is_guard) | .Param.Value ]
    + (if abl("outer") then [] else $ARGS.named.outer // [] end)) | unique) as $g
| (runs_foreign_code($root) or binds_ifs($root) or opaque_trap($root)) as $noprov
| "GUARDS\t\($g | tojson)",
  ( $root | paths(objects) as $pr | ($root | getpath($pr)) | select(.Type == "CallExpr")
  | cmd_args | select(length > 0)
  | cmd_name as $cmd
  | if $cmd == "rm" then
      (map(wlit) | index("--")) as $dd
      | (if $dd == null then .[1:] else .[1:$dd] end) as $opts
      | (if $dd == null then [] else .[$dd + 1:] end) as $after
      | select(any($opts[]; (wlit // "") | test("^-[^-]*[rRfF]|^--(recursive|force)$")))
      | ([ $opts[] | select((wlit // "") | startswith("-") | not) ] + $after) as $targets
      | (.[1:] | ident_names) as $others
      | {root: $root, pr: $pr, mk: $mk, guards: $g, others: $others, bounded: false, noprov: $noprov} as $c
      | $targets[] | (if abl("syntax") then . else tilde end) | judge($c) | "DENY\t\(.)"
    elif $cmd == "find" then
      (map(wlit // "")) as $w
      | select(any($w[]; . == "-delete")
               or any(range(0; ($w | length) - 1) as $i
                      | select($w[$i] | IN("-exec", if abl("syntax") then empty else "-execdir" end))
                      | $w[$i + 1] | basename; . == "rm"))
      | (reduce .[1:][] as $a ({skip: false, stop: false, paths: []};
          if .stop then .
          elif .skip then .skip = false
          else ($a | wlit // "") as $t
            | if ($t | IN("-H", "-L", "-P")) or ((abl("syntax") | not) and ($t | test("^-O[0-9]*$"))) then .
              elif $t == "-D" and (abl("syntax") | not) then .skip = true
              elif ($t | startswith("-")) then .stop = true
              else .paths += [$a] end
          end) | .paths) as $paths
      | (any($w[]; test("^-(i?name|i?path|i?regex|i?lname|type|xtype|newer[a-zA-Z]*|[acm]min|[acm]time|size|perm|user|group|uid|gid|links|empty|samefile|executable|readable|writable)$"))) as $bounded
      | ($paths | ident_names) as $others
      | {root: $root, pr: $pr, mk: $mk, guards: $g, others: $others, bounded: $bounded, noprov: $noprov} as $c
      | $paths[] | (if abl("syntax") then . else tilde end) | judge($c) | "DENY\t\(.)"
    else
      inner_of | "INNER\t\(.)"
    end ),
  # find -exec / -execdir … ; runs its own command words: a shell there is a child shell too.
  ( $root | select(abl("syntax") | not) | .. | objects | select(.Type == "CallExpr") | cmd_args | select(cmd_name == "find")
  | . as $a | (map(wlit // "")) as $w
  | range(0; $w | length) as $i | select($w[$i] | IN("-exec", "-execdir", "-ok", "-okdir"))
  | $a[$i + 1:] | (map(wlit // "" | sub("^\\\\"; "")) | index(";") // index("+") // length) as $end | .[:$end]
  | strip_wrappers | inner_of | "INNER\t\(.)" )
