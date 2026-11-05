/**
 * The three model-facing handlers — `arsenal_search`, `arsenal_browse`,
 * `arsenal_recommend`. Extracted from `tools.ts` so every module stays
 * inside the runner's 300-line file budget; the tool definitions that point
 * at them live in the parent.
 */
import { deriveFacets } from './tag-rules.js';
import { buildArsenalFtsMatch, buildArsenalFtsMatchAny, ENTRY_COLUMNS, facetFilterSql, optionalLimit, optionalTarget, optionalText, requiredText, toResultItem, } from './tools-query.js';
import { emptyIndexResult, indexStamp, serving } from './tools-store.js';
/* ------------------------------------------------------------------ */
/* arsenal_search (spec §7.2, ranking §7.5)                            */
/* ------------------------------------------------------------------ */
export async function runSearch(args) {
    const tool = 'arsenal_search';
    const query = requiredText(args, 'query', tool, 200);
    const filters = {
        category: optionalText(args, 'category', tool),
        target: optionalTarget(args, tool),
        battery: optionalText(args, 'battery', tool),
    };
    const limit = optionalLimit(args, tool);
    const live = serving();
    if (live === null)
        return emptyIndexResult();
    const { db, meta } = live;
    const facet = facetFilterSql(filters);
    const where = facet.sql === '' ? '' : ` AND ${facet.sql}`;
    const match = buildArsenalFtsMatch(query);
    const totalRow = db
        .prepare('SELECT count(*) AS n FROM entries_fts ' +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where}`)
        .get(match, ...facet.params);
    const total = Number(totalRow['n'] ?? 0);
    const rows = db
        .prepare(`SELECT ${ENTRY_COLUMNS}, bm25(entries_fts, 3.0, 1.0, 1.0, 0.0) AS score FROM entries_fts ` +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where} ` +
        'ORDER BY score ASC, e.name ASC, e.id ASC LIMIT ?')
        .all(match, ...facet.params, limit);
    return JSON.stringify({
        results: rows.map(toResultItem),
        total,
        index: indexStamp(meta),
    });
}
function topicTag(topic) {
    return `topic:${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}
export async function runBrowse(args) {
    const tool = 'arsenal_browse';
    const category = optionalText(args, 'category', tool);
    const live = serving();
    if (live === null)
        return emptyIndexResult();
    const { db, meta } = live;
    const collections = db
        .prepare('SELECT slug, name, url, description, topic, fetched_at, entry_count ' +
        'FROM collections ORDER BY name ASC, slug ASC')
        .all();
    if (category === undefined) {
        const byTopic = new Map();
        for (const c of collections) {
            const agg = byTopic.get(c.topic) ?? { collections: 0, entries: 0 };
            agg.collections += 1;
            agg.entries += c.entry_count;
            byTopic.set(c.topic, agg);
        }
        const topics = [...byTopic.entries()]
            .map(([topic, agg]) => ({
            topic,
            collections: agg.collections,
            entries: agg.entries,
        }))
            .sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
        return JSON.stringify({ topics, index: indexStamp(meta) });
    }
    const matched = collections.filter(c => c.topic === category ||
        c.slug === category ||
        topicTag(c.topic) === category);
    return JSON.stringify({
        collections: matched.map(c => ({
            slug: c.slug,
            name: c.name,
            url: c.url,
            description: c.description,
            entry_count: c.entry_count,
            level2: c.fetched_at !== null,
        })),
        index: indexStamp(meta),
    });
}
/* ------------------------------------------------------------------ */
/* arsenal_recommend (spec §7.4)                                       */
/* ------------------------------------------------------------------ */
export async function runRecommend(args) {
    const tool = 'arsenal_recommend';
    const task = requiredText(args, 'task', tool, 500);
    const target = optionalTarget(args, tool);
    const limit = optionalLimit(args, tool);
    const live = serving();
    if (live === null)
        return emptyIndexResult();
    const { db, meta } = live;
    const derived = deriveFacets(task);
    const facetSets = [
        { column: 'targets', values: derived.targets },
        { column: 'battery', values: derived.battery },
        { column: 'tags', values: derived.tags },
    ];
    // Facet-overlap count, computed in SQL so ordering (and the pre-limit
    // total) is exact: one point per stored facet the task's rules derived.
    const overlapTerms = [];
    const overlapParams = [];
    for (const set of facetSets) {
        if (set.values.length === 0)
            continue;
        const placeholders = set.values.map(() => '?').join(', ');
        overlapTerms.push(`(SELECT count(*) FROM json_each(e.${set.column}) WHERE json_each.value IN (${placeholders}))`);
        overlapParams.push(...set.values);
    }
    const overlapSql = overlapTerms.length === 0 ? '0' : overlapTerms.join(' + ');
    const facet = facetFilterSql(target === undefined ? {} : { target });
    const where = facet.sql === '' ? '' : ` AND ${facet.sql}`;
    const match = buildArsenalFtsMatchAny(task);
    if (match === '') {
        // A task of only whitespace/NULs was already rejected by requiredText;
        // a task whose terms all sanitize away cannot match — answer, don't throw.
        return JSON.stringify({ results: [], total: 0, index: indexStamp(meta) });
    }
    const totalRow = db
        .prepare('SELECT count(*) AS n FROM entries_fts ' +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where}`)
        .get(match, ...facet.params);
    const total = Number(totalRow['n'] ?? 0);
    const rows = db
        .prepare(`SELECT ${ENTRY_COLUMNS}, bm25(entries_fts, 3.0, 1.0, 1.0, 0.0) AS score, ` +
        `(${overlapSql}) AS overlap FROM entries_fts ` +
        'JOIN entries e ON e.id = entries_fts.rowid ' +
        'JOIN collections c ON c.slug = e.collection_slug ' +
        `WHERE entries_fts MATCH ?${where} ` +
        'ORDER BY overlap DESC, score ASC, e.name ASC, e.id ASC LIMIT ?')
        // Placeholder order follows the SQL text: the overlap expression sits
        // in the SELECT list, before the WHERE clause's MATCH and facet params.
        .all(...overlapParams, match, ...facet.params, limit);
    const derivedSets = {
        targets: new Set(derived.targets),
        battery: new Set(derived.battery),
        tags: new Set(derived.tags),
    };
    const results = rows.map((row) => {
        const item = toResultItem(row);
        const why = [];
        for (const t of item.targets) {
            if (derivedSets.targets.has(t))
                why.push(`target:${t}`);
        }
        for (const b of item.battery) {
            if (derivedSets.battery.has(b))
                why.push(`battery:${b}`);
        }
        for (const t of item.tags) {
            if (derivedSets.tags.has(t))
                why.push(`tag:${t}`);
        }
        why.sort();
        return { ...item, why };
    });
    return JSON.stringify({
        results,
        total,
        index: indexStamp(meta),
    });
}
//# sourceMappingURL=tools-handlers.js.map