import { ProtocolApi } from 'chrome-remote-interface';
import Protocol from 'devtools-protocol';
import RequestPausedEvent = Protocol.Fetch.RequestPausedEvent;
import RequestPattern = Protocol.Fetch.RequestPattern;
import GetResponseBodyResponse = Protocol.Fetch.GetResponseBodyResponse;
import {
    injectResources,
    PageInjectableResources,
    INJECTABLE_SCRIPTS as HAMMERHEAD_INJECTABLE_SCRIPTS,
} from 'testcafe-hammerhead';
import BrowserConnection from '../../../../connection';
import { SCRIPTS, TESTCAFE_UI_STYLES } from '../../../../../assets/injectables';

const HTTP_STATUS_OK = 200;

export default class RequestsInterceptor {
    private readonly _browserId: string;

    public constructor (browserId: string) {
        this._browserId = browserId;
    }

    private _getResponseAsString (response: GetResponseBodyResponse): string {
        return response.base64Encoded
            ? Buffer.from(response.body, 'base64').toString()
            : response.body;
    }

    private async _prepareInjectableResources (): Promise<PageInjectableResources> {
        const browserConnection = BrowserConnection.getById(this._browserId) as BrowserConnection;
        const proxy             = browserConnection.browserConnectionGateway.proxy;
        const windowId          = browserConnection.activeWindowId;

        const taskScript = await browserConnection.currentJob.currentTestRun.session.getTaskScript({
            referer:     '',
            cookieUrl:   '',
            isIframe:    false,
            withPayload: true,
            serverInfo:  proxy.server1Info,
            windowId,
        });

        const injectableResources = {
            stylesheets: [
                TESTCAFE_UI_STYLES,
            ],
            scripts: [
                ...HAMMERHEAD_INJECTABLE_SCRIPTS,
                ...SCRIPTS,
            ],
            embeddedScripts: [taskScript],
        };

        injectableResources.scripts     = injectableResources.scripts.map(script => proxy.resolveRelativeServiceUrl(script));
        injectableResources.stylesheets = injectableResources.stylesheets.map(style => proxy.resolveRelativeServiceUrl(style));

        return injectableResources;
    }

    public async setup (client: ProtocolApi): Promise<void> {
        const fetchAllDocumentsPattern = {
            urlPattern:   '*',
            resourceType: 'Document',
            requestStage: 'Response',
        } as RequestPattern;

        await client.Fetch.enable({ patterns: [fetchAllDocumentsPattern] });

        client.Fetch.on('requestPaused', async (params: RequestPausedEvent) => {
            const {
                requestId,
                responseHeaders,
                responseStatusCode,
            } = params;

            const responseObj         = await client.Fetch.getResponseBody({ requestId });
            const responseStr         = this._getResponseAsString(responseObj);
            const injectableResources = await this._prepareInjectableResources();
            const updatedResponseStr  = injectResources(responseStr, injectableResources);

            await client.Fetch.fulfillRequest({
                requestId,
                responseCode:    responseStatusCode || HTTP_STATUS_OK,
                responseHeaders: responseHeaders || [],
                body:            Buffer.from(updatedResponseStr).toString('base64'),
            });
        });
    }
}
