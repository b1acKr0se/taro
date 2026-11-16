<!-- Sent by the plugin to an owner when an agent it started has none of Taro's labels (TR-259). -->
You started {{agent}} without Taro's labels. The board does not list it, the plugin does not supervise it or deliver its report, and a permission ask from it would show no card. Paseo cannot add labels to a running agent.

Archive it (`taro agent stop {{id}}`) and start it again with `taro agent start <job> {{ticket}} --model <model> --brief-file <file> --task "<task>"` ({{skill}}/reference/paseo.md, "A subagent"), which adds the labels and environment. Then end your turn with a status line.
