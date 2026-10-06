"""Rank definitions by how the rest of the repository uses them.

Follows Aider's repo map (Apache-2.0): files are nodes, every reference to an
identifier is an edge from the referencing file to each file defining it,
weighted so that specific, mentioned and widely used names count most, and a
personalized PageRank over that graph scores each (file, identifier)
definition. PageRank is computed here directly so no graph library is needed.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping


def _identifier_weight(name: str, mentioned: set[str], definers: int) -> float:
    weight = 1.0
    if name in mentioned:
        weight *= 10
    is_snake = "_" in name and any(char.isalpha() for char in name)
    is_camel = any(char.isupper() for char in name[1:]) and any(char.islower() for char in name)
    if (is_snake or is_camel) and len(name) >= 8:
        weight *= 10
    if name.startswith("_"):
        weight *= 0.1
    if definers > 5:
        weight *= 0.1
    # Short names (get, set, run, str) collide everywhere and say little.
    if len(name) < 4:
        weight *= 0.1
    elif len(name) < 6:
        weight *= 0.5
    return weight


def _is_test(path: str) -> bool:
    lowered = path.lower()
    name = lowered.rsplit("/", 1)[-1]
    return (
        "/tests/" in f"/{lowered}"
        or "/test/" in f"/{lowered}"
        or "/__tests__/" in f"/{lowered}"
        or name.startswith("test_")
        or ".test." in name
        or ".spec." in name
        or name.endswith("_test.go")
    )


def pagerank(
    nodes: Iterable[str],
    edges: Mapping[tuple[str, str], float],
    personalization: Mapping[str, float] | None = None,
    *,
    damping: float = 0.85,
    iterations: int = 60,
    tolerance: float = 1e-9,
) -> dict[str, float]:
    node_list = sorted(set(nodes))
    if not node_list:
        return {}
    count = len(node_list)
    if personalization:
        total = sum(personalization.get(node, 0.0) for node in node_list)
        teleport = (
            {node: personalization.get(node, 0.0) / total for node in node_list}
            if total > 0
            else {node: 1 / count for node in node_list}
        )
    else:
        teleport = {node: 1 / count for node in node_list}
    out_weight: dict[str, float] = defaultdict(float)
    incoming: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for (source, target), weight in edges.items():
        out_weight[source] += weight
        incoming[target].append((source, weight))
    rank = {node: 1 / count for node in node_list}
    for _ in range(iterations):
        dangling = sum(rank[node] for node in node_list if out_weight[node] == 0)
        nxt = {}
        for node in node_list:
            flow = sum(
                rank[source] * weight / out_weight[source]
                for source, weight in incoming[node]
            )
            nxt[node] = (1 - damping) * teleport[node] + damping * (
                flow + dangling * teleport[node]
            )
        delta = sum(abs(nxt[node] - rank[node]) for node in node_list)
        rank = nxt
        if delta < tolerance:
            break
    return rank


def rank_definitions(
    defines: Mapping[str, set[str]],
    references: Mapping[str, list[str]],
    files: Iterable[str],
    *,
    focus_files: set[str] = frozenset(),
    mentioned: set[str] = frozenset(),
    family: Callable[[str], str] = lambda path: "",
) -> list[tuple[tuple[str, str], float]]:
    """Return ((file, identifier), score) for every definition, best first."""
    files = set(files)
    if not references:
        references = {name: list(definers) for name, definers in defines.items()}
    edges: dict[tuple[str, str], float] = defaultdict(float)
    edge_idents: dict[tuple[str, str], list[tuple[str, float]]] = defaultdict(list)
    for name in set(defines) & set(references):
        definers = defines[name]
        weight = _identifier_weight(name, mentioned, len(definers))
        for referencer, count in Counter(references[name]).items():
            boost = 50 if referencer in focus_files else 1
            amount = weight * boost * math.sqrt(count)
            for definer in definers:
                # A reference only reaches definitions in the same language.
                if family(referencer) != family(definer):
                    continue
                edge = amount * (0.3 if _is_test(definer) else 1.0)
                edges[(referencer, definer)] += edge
                edge_idents[(referencer, definer)].append((name, edge))
    # Lightly connect files that only define things, so they still rank.
    for name, definers in defines.items():
        for definer in definers:
            edges.setdefault((definer, definer), 0.1)
            edge_idents[(definer, definer)].append((name, 0.1))

    personalization = {}
    if focus_files or mentioned:
        share = 100 / max(1, len(files))
        for path in files:
            score = share if path in focus_files else 0.0
            stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if stem in mentioned:
                score += share
            if score:
                personalization[path] = score

    rank = pagerank(files, edges, personalization or None)
    # Each file hands its rank to its outgoing definitions in proportion to
    # their weight among *all* of its outgoing edges (as Aider does), so a
    # weak edge never inherits a file's whole rank.
    out_total: dict[str, float] = defaultdict(float)
    for (source, _target), entries in edge_idents.items():
        out_total[source] += sum(amount for _, amount in entries)
    scores: dict[tuple[str, str], float] = defaultdict(float)
    for (source, target), entries in edge_idents.items():
        total = out_total[source]
        if total <= 0:
            continue
        for name, amount in entries:
            scores[(target, name)] += rank.get(source, 0.0) * amount / total
    return sorted(scores.items(), key=lambda item: item[1], reverse=True)
