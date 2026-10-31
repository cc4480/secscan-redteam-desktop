/**
 * Authenticated msfrpcd client for the Metasploit bridge. Credential
 * resolution is fail-fast: missing REDTEAM_MSFRPC_USER/PASS throws with
 * setup instructions (never a silent unauthenticated attempt).
 * (Moved verbatim from MsfExecutor — same behavior as a free function.)
 */
import { MsfAuthError, MsfClient } from "../client.js";
import { createHttpMsfRequest, MsfTransportError } from "../protocol.js";
import { msfSecrets, resolveMsfCredentials } from "../policy.js";
import { redactSecrets } from "../../host-exec/common.js";
export async function authedClient(deps, timeoutMs, signal) {
    const creds = resolveMsfCredentials(deps.env);
    const secrets = msfSecrets(creds);
    const ep = deps.endpoint ?? { host: creds.host, port: creds.port, useTls: creds.useTls };
    const request = deps.request ??
        createHttpMsfRequest({ host: ep.host, port: ep.port, useTls: ep.useTls, timeoutMs, signal });
    const client = new MsfClient(request);
    try {
        await client.login(creds.user, creds.pass);
    }
    catch (err) {
        if (err instanceof MsfAuthError)
            throw err;
        throw new MsfTransportError(redactSecrets(`msfrpcd unreachable at ${ep.host}:${ep.port}: ${err.message}`, secrets));
    }
    return { client, secrets };
}
//# sourceMappingURL=auth.js.map