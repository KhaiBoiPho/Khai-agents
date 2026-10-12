"""Server-side page templates: list, info, create (or save a page as a
template), update, delete, use.

The built-in starter templates are client assets; these endpoints hold the
user's own, in kd_templates (so they follow the account across browsers).
``templates/use`` makes a page from a template with ``{{date}}`` filled in.
"""

from __future__ import annotations

from app_server.khaidocs.api import ApiError, Call, Router, camelize, page_of
from app_server.khaidocs.serialize import page_json
from core.khaidocs.importer import split_title
from core.khaidocs.markdown_pm import md_to_pm, pm_to_md
from core.khaidocs.templates import TemplateStore, fill_placeholders

router = Router()


def template_json(row: dict, *, full: bool = False) -> dict:
    out = camelize(row, drop=() if full else ("content", "markdown"))
    return out


@router.post("templates")
async def list_templates(call: Call):
    limit = call.body.get("limit")
    items, nxt = await call.run(
        TemplateStore(call.store.database).list, cursor=call.body.get("cursor"), limit=limit
    )
    return page_of([template_json(r) for r in items], limit or 100, nxt)


@router.post("templates/info")
async def info(call: Call):
    return template_json(await call.run(TemplateStore(call.store.database).get, str(call.need("templateId"))),
                         full=True)


@router.post("templates/create")
async def create(call: Call):
    body = call.body
    store = TemplateStore(call.store.database)
    content, markdown = body.get("content"), body.get("markdown")
    title, icon = body.get("title"), body.get("icon")
    if body.get("pageId"):  # save an existing page as a template
        page = await call.run(call.store.get_page, str(body["pageId"]))
        content = page.get("content") or {"type": "doc", "content": [{"type": "paragraph"}]}
        title = title or page["title"]
        icon = icon if icon is not None else page["icon"]
        markdown = pm_to_md(content)
    elif content is None and not isinstance(markdown, str):
        raise ApiError(400, "pageId, content or markdown is required")
    row = await call.run(
        store.create, title=title or "", description=body.get("description"), icon=icon,
        content=content if isinstance(content, dict) else None,
        markdown=markdown if isinstance(markdown, str) else None,
    )
    return template_json(row, full=True)


@router.post("templates/update")
async def update(call: Call):
    fields = {k: call.body[k] for k in ("title", "description", "icon", "markdown", "content") if k in call.body}
    row = await call.run(TemplateStore(call.store.database).update, str(call.need("templateId")), **fields)
    return template_json(row, full=True)


@router.post("templates/delete")
async def delete(call: Call):
    await call.run(TemplateStore(call.store.database).delete, str(call.need("templateId")))
    return None


@router.post("templates/use")
async def use(call: Call):
    """A new page from a template: ``{templateId, spaceId?, parentPageId?, title?}``."""

    template = await call.run(TemplateStore(call.store.database).get, str(call.need("templateId")))
    content = template["content"]
    title = call.body.get("title") or template["title"]
    if content is None:
        found, content = split_title(md_to_pm(template["markdown"] or ""))
        title = call.body.get("title") or found or title
    content = fill_placeholders(content)
    page = await call.run(
        call.store.create_page, space_id=call.body.get("spaceId"),
        parent_page_id=call.body.get("parentPageId"), title=fill_placeholders(title or ""),
        icon=template["icon"], content=content, updated_by="import", with_content=True,
    )
    spaces = {s["id"]: s for s in await call.run(call.store.list_spaces)}
    return page_json(page, call.user, space=spaces.get(page["space_id"]), full=True)
