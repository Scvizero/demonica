# Demonica

Інтерактивна WebGL-сцена з персонажем і вогнем на Next.js, React Three Fiber та Three.js.

## Локальна розробка

```bash
npm ci
npm run dev
```

Відкрийте [http://localhost:3000](http://localhost:3000).

## Команди

- `npm run dev` — локальний сервер розробки
- `npm run build` — production-збірка
- `npm run lint` — перевірка ESLint

## GitHub Pages

Репозиторій публікується через GitHub Actions на адресу <https://scvizero.github.io/demonica/>. У репозиторії відкрийте **Settings → Pages** і виберіть **GitHub Actions** як джерело розгортання. Далі кожен push у `main` збирає Next.js як статичний сайт і публікує папку `out/`.

Під час Pages-збірки шлях `/demonica` вмикається автоматично, зокрема для моделі `public/models/143.glb`. Локальна розробка лишається на `http://localhost:3000` без базового шляху.
