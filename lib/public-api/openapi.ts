import { ALL_PERMIT_STATUSES } from '@/lib/permit-status/transitions';
import { PROJECT_STATUS_VALUES } from '@/lib/intake/schemas';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination';
import { KEY_RATE_LIMIT_PER_MINUTE } from './handler';

const uuid = { type: 'string', format: 'uuid' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const nullableUuid = { type: ['string', 'null'], format: 'uuid' } as const;
const nullableDate = { type: ['string', 'null'], format: 'date' } as const;
const timestamp = { type: 'string', format: 'date-time' } as const;

const pageParams = [
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT },
  },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
];

const errorResponses = {
  '400': { $ref: '#/components/responses/Error' },
  '401': { $ref: '#/components/responses/Error' },
  '403': { $ref: '#/components/responses/Error' },
  '429': { $ref: '#/components/responses/Error' },
};

function listResponse(schemaRef: string) {
  return {
    description: 'A page of results, newest first.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['data', 'pagination'],
          properties: {
            data: { type: 'array', items: { $ref: schemaRef } },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        },
      },
    },
  };
}

function singleResponse(schemaRef: string) {
  return {
    description: 'The requested resource.',
    content: {
      'application/json': {
        schema: { type: 'object', required: ['data'], properties: { data: { $ref: schemaRef } } },
      },
    },
  };
}

const idParam = { name: 'id', in: 'path', required: true, schema: uuid };

export function buildOpenApiDocument(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'PermitField OS API',
      version: '1.0.0',
      description: `Read-only access to your organization's projects and permit applications. Authenticate with an API key created under Settings → API keys, sent as \`Authorization: Bearer <key>\`. Each key is limited to ${KEY_RATE_LIMIT_PER_MINUTE} requests per minute.`,
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/projects': {
        get: {
          summary: 'List projects',
          parameters: [
            ...pageParams,
            { name: 'status', in: 'query', schema: { type: 'string', enum: [...PROJECT_STATUS_VALUES] } },
          ],
          responses: { '200': listResponse('#/components/schemas/Project'), ...errorResponses },
        },
      },
      '/projects/{id}': {
        get: {
          summary: 'Get a project',
          parameters: [idParam],
          responses: {
            '200': singleResponse('#/components/schemas/Project'),
            '404': { $ref: '#/components/responses/Error' },
            ...errorResponses,
          },
        },
      },
      '/applications': {
        get: {
          summary: 'List permit applications',
          parameters: [
            ...pageParams,
            { name: 'project_id', in: 'query', schema: uuid },
            { name: 'permit_status', in: 'query', schema: { type: 'string', enum: [...ALL_PERMIT_STATUSES] } },
          ],
          responses: { '200': listResponse('#/components/schemas/Application'), ...errorResponses },
        },
      },
      '/applications/{id}': {
        get: {
          summary: 'Get a permit application',
          parameters: [idParam],
          responses: {
            '200': singleResponse('#/components/schemas/Application'),
            '404': { $ref: '#/components/responses/Error' },
            ...errorResponses,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'An API key beginning with pfk_.' },
      },
      responses: {
        Error: {
          description: 'Error.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['error'],
                properties: {
                  error: {
                    type: 'object',
                    required: ['code', 'message'],
                    properties: { code: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      schemas: {
        Pagination: {
          type: 'object',
          required: ['limit', 'offset', 'has_more'],
          properties: {
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            has_more: { type: 'boolean' },
          },
        },
        Project: {
          type: 'object',
          properties: {
            id: uuid,
            title: { type: 'string' },
            description: nullableString,
            status: { type: 'string', enum: [...PROJECT_STATUS_VALUES] },
            applicant_name: nullableString,
            property_owner_name: nullableString,
            client_id: nullableUuid,
            property_id: nullableUuid,
            contractor_id: nullableUuid,
            archived_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: timestamp,
            updated_at: timestamp,
          },
        },
        Application: {
          type: 'object',
          properties: {
            id: uuid,
            project_id: nullableUuid,
            project_title: { type: 'string' },
            project_address: { type: 'string' },
            status: { type: 'string', description: 'Document-processing status.' },
            permit_status: { type: 'string', enum: [...ALL_PERMIT_STATUSES] },
            permit_number: nullableString,
            permit_type_id: uuid,
            contractor_id: uuid,
            decision_date: nullableDate,
            permit_expires_on: nullableDate,
            estimated_job_value_cents: {
              type: ['integer', 'null'],
              description: 'Minor units of currency_code.',
            },
            currency_code: { type: 'string', minLength: 3, maxLength: 3 },
            created_at: timestamp,
            updated_at: timestamp,
          },
        },
      },
    },
  };
}
