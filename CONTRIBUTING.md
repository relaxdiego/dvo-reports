# Contributing

## Where work is tracked

**GitHub Issues is the only tracker.** Bugs, feature requests, and change
requests all live there. There is no board, no `TODO.md`, and no backlog file
in this repository. If it is not an issue, it is not tracked.

That means:

- Open an issue before a pull request, unless the change is a typo. The
  discussion belongs where anyone can find it later.
- Every pull request closes an issue. Put `Closes #123` in the description.
- A `TODO` in the code is a note about the line it sits on, not a work item.
  Anything worth remembering after the branch merges becomes an issue.
- Decisions that came out of an issue and still matter later belong in
  `docs/` or `AGENTS.md`. A closed issue is a record, not documentation.

Pick a template when you open an issue:

| Template               | For                                                  |
| ---------------------- | ---------------------------------------------------- |
| Bug report             | The app does the wrong thing.                        |
| Feature/change request | The app should do something, or do it differently.   |
| Upstream finding       | Something you learned about the city's own site.     |

**Never paste a real report into an issue.** No photographs of a real place,
no home address, no phone number, no email. This tracker is public, and
protecting that information is the point of the project. A security problem
goes through a [private advisory][advisory], not a public issue.

[advisory]: https://github.com/relaxdiego/dvo-reports/security/advisories/new

## Getting set up

The toolchain is pinned with [devbox](https://www.jetify.com/devbox) and
loaded by [direnv](https://direnv.net):

```sh
direnv allow          # or: devbox shell
make dev-backend      # Go API on :8080
make dev-frontend     # Vite on :5173
```

Before you open a pull request:

```sh
make lint && make test
```

`AGENTS.md` records the decisions behind the code, including the rules that
are not up for negotiation. Read it before a first change.

## The most useful thing you can do

Tell us when `reports.davaocity.gov.ph` changes. This project imitates a web
form that nobody documents, so the city can break it without warning and
without meaning to. If a report fails, or the site starts behaving oddly, open
an **Upstream finding** issue and say what you saw. See
[docs/upstream.md](docs/upstream.md) for what is already known.

## Licensing your contribution

This project is [Apache-2.0](LICENSE). By opening a pull request you offer your
contribution under that same licence, as Apache-2.0 section 5 sets out. There
is nothing else to sign.
