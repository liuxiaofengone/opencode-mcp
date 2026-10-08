# Security

The bridge grants the local OpenCode process access according to OpenCode permissions. Its read-only mode is not an operating-system sandbox. File contents can reach the chosen model provider, and OpenCode can write its own runtime data.

Do not include credentials, private project data or exploit secrets in public Issues. Use the repository's GitHub private vulnerability reporting feature when it is available. Otherwise contact the maintainer through the public profile to arrange a private report before sharing sensitive details.

For non-sensitive bugs, provide a minimal fake-CLI reproduction where possible. Local configuration, plugins, executable provenance and provider credentials remain the operator's responsibility.
