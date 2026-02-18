# Kexo agent rules

See **AGENT_RULES.md** at repo root for full rules.

**Push proof (after every push):** run and paste:

```
git rev-parse HEAD
git branch --show-current
git ls-remote --heads origin $(git branch --show-current)
```

Remote ref must match HEAD.
