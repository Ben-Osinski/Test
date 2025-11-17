# SharePoint React App (Vite + TypeScript)

This project is pre-wired for your Data Center Feasibility Tool and SharePoint embedding.

## 1) Install prerequisites (once per computer)
- Install **Node.js LTS** (18.x or 20.x): https://nodejs.org/en
- Install **Git** (optional but nice for VS Code terminal): https://git-scm.com/downloads
- Install **Visual Studio Code**: https://code.visualstudio.com/

## 2) Open this folder in VS Code
- Extract this zip to a simple path (e.g., `C:\dc-tool` on Windows).
- Open VS Code → File → Open Folder… → select the extracted folder.

## 3) Install packages
Open **Terminal → New Terminal** in VS Code and run:
```bash
npm install
```

## 4) Add shadcn/ui components (matches your imports)
Your TSX file imports components from `@/components/ui/*`. Generate them with:
```bash
npx shadcn-ui@latest init
# Press Enter to accept defaults
npx shadcn-ui@latest add button card input label select tabs switch
```
This will create files under `src/components/ui/*`.

> If the generator asks about Tailwind, it's already configured.

## 5) Build the static site
```bash
npm run build
```
The build output will be in the `dist/` folder.

## 6) Upload to SharePoint and embed
1. In your SharePoint site, open the **Site Assets** library (or create a document library like **dc-feasibility**).
2. Create a folder like **tool**.
3. Upload **all files inside** the `dist/` folder into that **tool** folder (keep the same folder structure: `index.html` next to `assets/`).
4. Go to the SharePoint page where you want the app → **Edit** → add the **Embed** web part.
5. Paste the full URL to the uploaded `index.html` (e.g., `https://yourtenant.sharepoint.com/sites/.../SiteAssets/tool/index.html`) and click **Insert**.
6. Publish the page.

If assets 404 or styles/scripts don't load, make sure the `assets/` folder was uploaded next to `index.html` and that `vite.config.ts` has `base: './'`.

## 7) Optional: run locally for testing
```bash
npm run dev
```
Open the URL shown (usually `http://localhost:5173`).

