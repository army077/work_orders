/** No Firebase initialization here. The existing session and its confirmed project
 * must be supplied by the app only after API27's identity contract is agreed. */
export type Api27TokenProvider = () => Promise<string>;

type FirebaseSession = {
    app: { options: { projectId?: string } };
    authStateReady(): Promise<void>;
    currentUser: { getIdToken(): Promise<string> } | null;
};

export class Api27AuthError extends Error {
    readonly statusCode = 401;
    constructor() {
        super("No hay una sesión compatible y vigente para API27. Verifica la sesión autorizada.");
        this.name = "Api27AuthError";
    }
}

/** Firebase getIdToken() handles expiration/refresh; never cache or persist it here. */
export function createFirebaseIdTokenProvider(session: FirebaseSession, confirmedProjectId: string): Api27TokenProvider {
    if (!confirmedProjectId || confirmedProjectId.trim() !== confirmedProjectId ||
        session.app.options.projectId !== confirmedProjectId) throw new Api27AuthError();
    return async () => {
        try {
            await session.authStateReady();
            const user = session.currentUser;
            if (!user || session.app.options.projectId !== confirmedProjectId) throw new Api27AuthError();
            const token = await user.getIdToken();
            // Do not dispatch a token belonging to a session that changed while waiting.
            if (session.currentUser !== user || typeof token !== "string" || !token || /\s/.test(token)) {
                throw new Api27AuthError();
            }
            return token;
        } catch {
            // SDK errors may contain credentials. Never expose the original error/cause.
            throw new Api27AuthError();
        }
    };
}
