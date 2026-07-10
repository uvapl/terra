# Edit history (Terra plugin)

Keeps track of edit history for code files. It is configured to work in the
IDE. Users can access history via the **File** menu and browse earlier
checkpoints.

- Simple inserts and other edits at a single place are accumulated into a 
  single checkpoint.
- Copy and paste are added.
- Undo and redo are added.
- External edits are added (relevant when directly using an external LFS).
- Reverts are possible and add a new marked history checkpoint.

To make it work in exam mode, there needs to be a way of submitting the hidden
history files (or a decision to keep it as a student facility but not submit
it).
