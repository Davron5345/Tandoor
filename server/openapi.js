const errorResponse = {
  description: 'Ошибка',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

function op(summary, tags, extra = {}) {
  return {
    summary,
    tags,
    security: extra.public ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }],
    ...extra,
    responses: {
      ...extra.responses,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  };
}

export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Приход-расход API',
      version: '1.0.0',
      description: [
        'REST API складского учёта.',
        '',
        '**Авторизация:** после `POST /auth/login` сессия хранится в HttpOnly-cookie `warehouse_session`.',
        'Альтернатива — заголовок `Authorization: Bearer <token>`.',
        '',
        '**Филиал:** для большинства операций передайте `branch_id` в query или заголовок `X-Branch-Id`.',
      ].join('\n'),
    },
    servers: [{ url: '/api' }],
    tags: [
      { name: 'auth', description: 'Вход и сессия' },
      { name: 'documents', description: 'Складские документы' },
      { name: 'catalog', description: 'Товары и калькуляции' },
      { name: 'counterparties', description: 'Контрагенты' },
      { name: 'finance', description: 'Касса и оплаты' },
      { name: 'org', description: 'Филиалы, отделы, сотрудники, отчёты' },
      { name: 'telegram', description: 'Telegram-бот' },
      { name: 'admin', description: 'Администрирование' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'warehouse_session',
          description: 'HttpOnly cookie, выставляется при логине',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'session-token',
        },
      },
      parameters: {
        branchIdQuery: {
          name: 'branch_id',
          in: 'query',
          schema: { type: 'string' },
          description: 'ID филиала (для admin; остальным подставляется свой филиал)',
        },
        branchIdHeader: {
          name: 'X-Branch-Id',
          in: 'header',
          schema: { type: 'string' },
        },
        page: {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        limit: {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        },
        id: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
        Ok: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
            branch_id: { type: 'string', nullable: true },
            must_change_password: { type: 'boolean' },
          },
        },
        PageResult: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'object' } },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            pages: { type: 'integer' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string', format: 'password' },
          },
        },
        ChangePasswordRequest: {
          type: 'object',
          required: ['current_password', 'new_password'],
          properties: {
            current_password: { type: 'string' },
            new_password: { type: 'string', minLength: 8 },
          },
        },
        Document: {
          type: 'object',
          description: 'Складской документ (приход, расход, перемещение, разделка и др.)',
          additionalProperties: true,
        },
      },
    },
    paths: {
      '/health': {
        get: op('Проверка сервера', ['auth'], {
          public: true,
          responses: {
            200: {
              description: 'Сервер работает',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      telegram: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        }),
      },
      '/auth/login': {
        post: op('Вход', ['auth'], {
          public: true,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: {
              description: 'Успешный вход, cookie сессии в Set-Cookie',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { user: { $ref: '#/components/schemas/User' } },
                  },
                },
              },
            },
          },
        }),
      },
      '/auth/logout': {
        post: op('Выход', ['auth'], {
          responses: { 200: { description: 'Сессия завершена', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } } },
        }),
      },
      '/auth/me': {
        get: op('Текущий пользователь', ['auth'], {
          responses: { 200: { description: 'Профиль', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
        }),
      },
      '/auth/change-password': {
        post: op('Смена пароля', ['auth'], {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordRequest' } } },
          },
          responses: {
            200: {
              description: 'Пароль изменён',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      user: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        }),
      },
      '/auth/roles': {
        get: op('Список ролей (краткий)', ['auth'], {
          responses: { 200: { description: 'Роли', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
      },
      '/documents': {
        get: op('Список документов', ['documents'], {
          parameters: [
            { $ref: '#/components/parameters/branchIdQuery' },
            { $ref: '#/components/parameters/page' },
            { $ref: '#/components/parameters/limit' },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'confirmed', 'cancelled'] } },
            { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: {
            200: {
              description: 'Массив или страница (при page/limit)',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { type: 'array', items: { $ref: '#/components/schemas/Document' } },
                      { $ref: '#/components/schemas/PageResult' },
                    ],
                  },
                },
              },
            },
          },
        }),
        post: op('Создать документ', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } },
          responses: { 201: { description: 'Создан', content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } } },
        }),
      },
      '/documents/next-number': {
        get: op('Следующий номер документа', ['documents'], {
          parameters: [
            { $ref: '#/components/parameters/branchIdQuery' },
            { name: 'type', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Номер',
              content: { 'application/json': { schema: { type: 'object', properties: { number: { type: 'string' } } } } },
            },
          },
        }),
      },
      '/documents/{id}': {
        get: op('Документ по ID', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Документ', content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } }, 404: errorResponse },
        }),
        put: op('Обновить документ', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } },
          responses: { 200: { description: 'Обновлён', content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } } },
        }),
        delete: op('Удалить документ', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Удалён', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } } },
        }),
      },
      '/documents/{id}/confirm': {
        post: op('Провести документ', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Проведён', content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } } },
        }),
      },
      '/documents/{id}/cancel': {
        post: op('Отменить документ', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Отменён', content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } } } },
        }),
      },
      '/documents/{id}/history': {
        get: op('История изменений документа', ['documents'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'История', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
      },
      '/products': {
        get: op('Список товаров', ['catalog'], {
          parameters: [
            { $ref: '#/components/parameters/branchIdQuery' },
            { $ref: '#/components/parameters/page' },
            { $ref: '#/components/parameters/limit' },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'category_id', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Массив или страница',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { type: 'array', items: { type: 'object' } },
                      { $ref: '#/components/schemas/PageResult' },
                    ],
                  },
                },
              },
            },
          },
        }),
        post: op('Создать товар', ['catalog'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Создан', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/products/{id}': {
        put: op('Обновить товар', ['catalog'], {
          parameters: [{ $ref: '#/components/parameters/id' }, { $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'Обновлён', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
        delete: op('Удалить товар', ['catalog'], {
          parameters: [{ $ref: '#/components/parameters/id' }],
          responses: { 200: { description: 'Удалён', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } } },
        }),
      },
      '/products/{id}/images': {
        get: op('Изображения товара', ['catalog'], {
          parameters: [
            { $ref: '#/components/parameters/id' },
            { name: 'variant_id', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Список изображений', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Загрузить изображение', ['catalog'], {
          parameters: [
            { $ref: '#/components/parameters/id' },
            { name: 'variant_id', in: 'query', schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
          },
          responses: { 201: { description: 'Загружено', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/product-categories': {
        get: op('Категории товаров', ['catalog'], {
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Создать категорию', ['catalog'], {
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Создана', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/counterparties': {
        get: op('Контрагенты', ['counterparties'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Создать контрагента', ['counterparties'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Создан', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/payments': {
        get: op('Оплаты / касса', ['finance'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Создать оплату', ['finance'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Создана', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/cash-articles': {
        get: op('Статьи кассы (активные)', ['finance'], {
          parameters: [{ name: 'direction', in: 'query', schema: { type: 'string', enum: ['in', 'out'] } }],
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
      },
      '/stats': {
        get: op('Сводка для главной', ['org'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Статистика', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/reports/stock': {
        get: op('Отчёт по остаткам', ['org'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Остатки', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
      },
      '/branches': {
        get: op('Филиалы', ['org'], {
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Создать филиал', ['org'], {
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Создан', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/departments': {
        get: op('Отделы филиала', ['org'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
      },
      '/users': {
        get: op('Сотрудники', ['org'], {
          responses: { 200: { description: 'Список', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Создать сотрудника', ['org'], {
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Создан', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/telegram/status': {
        get: op('Статус Telegram', ['telegram'], {
          responses: { 200: { description: 'Статус', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/telegram/send': {
        post: op('Отправить сообщение', ['telegram'], {
          parameters: [{ $ref: '#/components/parameters/branchIdQuery' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'Отправлено', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
      '/admin/audit-log': {
        get: op('Журнал аудита', ['admin'], {
          parameters: [
            { $ref: '#/components/parameters/page' },
            { $ref: '#/components/parameters/limit' },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'username', in: 'query', schema: { type: 'string' } },
            { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { 200: { description: 'Страница записей', content: { 'application/json': { schema: { $ref: '#/components/schemas/PageResult' } } } } },
        }),
      },
      '/roles/list': {
        get: op('Роли со статистикой', ['admin'], {
          responses: { 200: { description: 'Роли', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
      },
      '/admin/backups': {
        get: op('Список бэкапов БД', ['admin'], {
          responses: { 200: { description: 'Бэкапы', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
        }),
        post: op('Создать бэкап БД', ['admin'], {
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
          responses: { 201: { description: 'Создан', content: { 'application/json': { schema: { type: 'object' } } } } },
        }),
      },
    },
    externalDocs: {
      description: 'Файлы изображений товаров',
      url: '/uploads/products/{productId}/{fileName}',
    },
  };
}

export function renderApiDocsHtml() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API — Приход-расход</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>body { margin: 0; } #swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;
}
