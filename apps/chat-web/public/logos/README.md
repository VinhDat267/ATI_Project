# Third-party service marks

Downloaded on 2026-10-03 from the official brand sources; SVG artwork is copied unchanged. Marks identify ATI integrations, not ATI's own identity or provider endorsement. Display names beside each mark are native ATI interface text.

| Local file | Original asset | Official source |
| --- | --- | --- |
| github.svg | GitHub_Invertocat_Black.svg | https://brand.github.com/GitHub_Logos.zip |
| trello.svg | trello/svg/Trello_icon.svg | https://atlassian.design/assets/1f181c2c377d/logos/trello_app.zip |
| slack.svg | marketing/img/nav/logo.svg | https://a.slack-edge.com/9cc0056/marketing/img/nav/logo.svg |
| google-sheets.svg | Sheets 2026 Q3 web mark | https://www.gstatic.com/images/branding/productlogos/sheets_2026q3/v1/web/192px.svg |
| google-calendar.svg | Calendar 2026 web mark | https://www.gstatic.com/images/branding/productlogos/calendar_2026/v2/web/192px.svg |
| notion.png | Notion site app icon | https://www.notion.com/front-static/logo-ios.png |
| telegram.svg | Telegram official website icon | https://telegram.org/img/website_icon.svg?4 |
| jira.svg | jira/SVG/Jira_icon.svg | https://atlassian.design/assets/1f181c2c377d/logos/jira_app.zip |

Usage references: [GitHub](https://brand.github.com/foundations/logo), [Atlassian](https://atlassian.design/foundations/logos/), [Slack Media Kit](https://slack.com/media-kit). These assets remain the trademarks/copyrights of their respective owners. Do not recolor, distort, add graphic effects, or combine them into ATI's logo.

No remote URL is requested by the app for these assets. Each decorative image has a native service name beside it, and intrinsic width/height reserve its space during loading.

Roadmap sources observed in the official pages: [Sheets](https://workspace.google.com/products/sheets/), [Calendar](https://workspace.google.com/products/calendar/), [Notion](https://www.notion.com/), [Telegram Press](https://telegram.org/press), [Atlassian Logos](https://atlassian.design/foundations/logos/). The five roadmap marks identify future services only; they do not imply live integration or connection.

`ServiceLogo` in `src/components/Brand.tsx` owns the mapping. `Icon` delegates known service names to it, so service cards, hero steps, plan steps, login illustration and workspace suggestions share these files; functional controls keep Lucide icons. The marquee uses `ServiceLogo` directly.
