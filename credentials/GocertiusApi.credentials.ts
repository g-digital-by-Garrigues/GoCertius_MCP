import {
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class GocertiusApi implements ICredentialType {
  name = 'gocertiusApi';
  displayName = 'GoCertius API';
  documentationUrl = 'https://github.com/g-digital-by-Garrigues/GoCertius_MCP';

  properties: INodeProperties[] = [
    {
      displayName: 'API Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api-gocertius.gocertius.io',
      description:
        'Base URL of the GoCertius REST API. Leave as-is for the production environment.',
    },
    {
      displayName: 'Auth Email',
      name: 'MCP_AUTH_EMAIL',
      type: 'string',
      default: '',
      description: 'Your GoCertius account email address.',
    },
    {
      displayName: 'Auth Password',
      name: 'MCP_AUTH_PASSWORD',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Your GoCertius account password.',
    },
    {
      displayName: 'OpenID Client ID',
      name: 'MCP_OPENID_CLIENT_ID',
      type: 'string',
      default: '',
      description: 'OpenID Connect client ID (alternative to email/password auth).',
    },
    {
      displayName: 'OpenID Issuer URL',
      name: 'MCP_OPENID_ISSUER',
      type: 'string',
      default: '',
      description: 'OpenID Connect issuer URL (alternative to email/password auth).',
    },
    {
      displayName: 'OpenID Refresh Token',
      name: 'MCP_OPENID_REFRESH_TOKEN',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'OpenID Connect refresh token (alternative to email/password auth).',
    },
  ];

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/session',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        email: '={{$credentials.MCP_AUTH_EMAIL}}',
        password: '={{$credentials.MCP_AUTH_PASSWORD}}',
      },
    },
  };
}
