const clientId = process.env.WORKOS_CLIENT_ID;
const environmentId = process.env.WORKOS_ENVIRONMENT_ID;

const authConfig = {
  providers: [
    {
      type: 'customJwt',
      issuer: 'https://api.workos.com/',
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: 'customJwt',
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
    ...(environmentId
      ? [
          {
            type: 'customJwt',
            // allow tokens minted for the environment-level issuer in production
            issuer: `https://api.workos.com/user_management/${environmentId}`,
            algorithm: 'RS256',
            jwks: `https://api.workos.com/sso/jwks/${clientId}`,
          },
        ]
      : []),
  ],
};

export default authConfig;
