"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractValue = extractValue;
exports.extractText = extractText;
exports.extractAttribute = extractAttribute;
exports.checkForSoapFault = checkForSoapFault;
exports.extractShellId = extractShellId;
exports.extractCommandId = extractCommandId;
exports.extractStreams = extractStreams;
exports.extractSendResult = extractSendResult;
// Dynamic XML value extractor
function extractValue(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current?.[key];
    }, obj);
}
// Extract text content, handling both direct strings and _ property
function extractText(obj) {
    if (typeof obj === 'string')
        return obj;
    if (typeof obj === 'object' && obj && '_' in obj)
        return obj._;
    return String(obj || '');
}
// Get attribute value from $ object
function extractAttribute(obj, attrName) {
    if (typeof obj === 'object' && obj && '$' in obj) {
        const attrs = obj.$;
        // Try different attribute name formats that fast-xml-parser might use
        return (attrs[attrName] || attrs[`@_${attrName}`] || attrs[`@${attrName}`] || '');
    }
    return '';
}
// Check for SOAP fault in response
function checkForSoapFault(response) {
    const fault = extractValue(response, 's:Envelope.s:Body.s:Fault');
    if (fault) {
        const errorValue = extractValue(fault, 's:Code.s:Subcode.s:Value');
        throw new Error(String(errorValue || 'SOAP Fault occurred'));
    }
}
// Extract shell ID from various possible locations in response
function extractShellId(response) {
    checkForSoapFault(response);
    // Try to get from ResourceCreated selector first (most reliable)
    const selectorValue = extractValue(response, 's:Envelope.s:Body.x:ResourceCreated.a:ReferenceParameters.w:SelectorSet.w:Selector');
    if (selectorValue) {
        return extractText(selectorValue);
    }
    // Fallback to rsp:Shell element
    const shellId = extractValue(response, 's:Envelope.s:Body.rsp:Shell.rsp:ShellId');
    if (shellId) {
        return extractText(shellId);
    }
    throw new Error('Unable to extract shell ID from response');
}
// Extract command ID from command response
function extractCommandId(response) {
    checkForSoapFault(response);
    const commandId = extractValue(response, 's:Envelope.s:Body.rsp:CommandResponse.rsp:CommandId');
    if (commandId) {
        return extractText(commandId);
    }
    throw new Error('Unable to extract command ID from response');
}
// Extract streams from receive response
function extractStreams(response) {
    checkForSoapFault(response);
    const streams = extractValue(response, 's:Envelope.s:Body.rsp:ReceiveResponse.rsp:Stream');
    if (!streams) {
        return [];
    }
    // Handle both single stream and array of streams
    const streamArray = Array.isArray(streams) ? streams : [streams];
    return streamArray.map((stream) => ({
        name: extractAttribute(stream, 'Name') || '',
        content: extractText(stream) || '',
        end: extractAttribute(stream, 'End') === 'true',
    }));
}
// Extract result from Send operation response
function extractSendResult(response) {
    checkForSoapFault(response);
    // Send operation success is indicated by absence of fault
    // No additional data needs to be extracted for successful sends
}
