import { Notify, Dialog } from 'quasar';

import Breadcrumb from 'components/breadcrumb';

import AuditService from '@/services/audit';
import Utils from '@/services/utils';
import DataService from '@/services/data';
import { $t } from '@/boot/i18n'

export default {
    props: {
        frontEndAuditState: Number,
        parentState: String,
        parentApprovals: Array
    },
    data: () => {
        return {
            auditId: null,
            audit: {
                // scope: []
            },
            audit: {
                creator: {},
                name: "",
                auditType: "",
                client: {},
                company: {},
                collaborators: [],
                reviewers: [],
                date: "",
                date_start: "",
                date_end: "",
                scope: [],
                language: "",
                template: "",
                customFields: [],
                approvals: []
            },
            auditOrig: {},
            // List of available targets for select options
            targetsOptions: [],
            // List of selected targets
            selectedTargets: [],
            // Current Host to display detail of open services
            currentHost: null,
            // Datatable headers for displaying host
            dtHostHeaders: [
                {name: 'port', label: 'Port', field: 'port', align: 'left', sortable: true, sort: (a, b) => parseInt(a, 10) - parseInt(b, 10)},
                {name: 'protocol', label: 'Protocol', field: 'protocol', align: 'left', sortable: true},
                {name: 'name', label: 'Service', field: 'name', align: 'left', sortable: true},
                {name: 'version', label: 'Version', field: 'version', align: 'left', sortable: true}
            ],
            // Datatable pagination for displaying host
            hostPagination: {
                page: 1,
                rowsPerPage: 20,
                sortBy: 'port'
            },
            AUDIT_VIEW_STATE: Utils.AUDIT_VIEW_STATE
        }
    },

    components: {
        Breadcrumb
    },

    mounted: function() {
        this.auditId = this.$route.params.auditId;
	// Load general audit data first (including scopes), then network data
        this.getAuditGeneral()
        .then(() => {
            return this.getAuditNetwork();
        });
        this.$socket.emit('menu', {menu: 'network', room: this.auditId});

        // save on ctrl+s
        var lastSave = 0;
        document.addEventListener('keydown', this._listener, false)

    },

    destroyed: function() {
        document.removeEventListener('keydown', this._listener, false)
    },

    beforeRouteLeave (to, from , next) {
        if (this.$_.isEqual(this.audit, this.auditOrig))
            next();
        else {
            Dialog.create({
                title: $t('msg.thereAreUnsavedChanges'),
                message: $t('msg.doYouWantToLeave'),
                ok: {label: $t('btn.confirm'), color: 'negative'},
                cancel: {label: $t('btn.cancel'), color: 'white'}
            })
            .onOk(() => next())
        }
    },

    computed: {
        selectHostsLabel: function() {
            if (this.targetsOptions && this.targetsOptions.length > 0)
                return $t('msg.selectHost')
            else
                return $t('msg.importHostsFirst')
        }
    },

    methods: {
        _listener: function(e) {
            if ((window.navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey) && e.keyCode == 83) {
                e.preventDefault();
                // Only trigger save if we're in the network audit context
                if (this.frontEndAuditState === this.AUDIT_VIEW_STATE.EDIT && 
                    this.$route.name === 'network')
                    this.updateAuditNetwork();
            }
        },

        // Get Audit datas from uuid
        getAuditNetwork: function() {
	    return AuditService.getAuditNetwork(this.auditId)
            .then((data) => {
                this.audit = data.data.datas;
                // Merge network audit data with existing audit data, preserving general data like scopes
		Object.assign(this.audit, data.data.datas);
                this.auditOrig = this.$_.cloneDeep(this.audit);
            })
            .catch((err) => {
                console.log(err)
            })
        },
        getAuditGeneral: function() {
	    return AuditService.getAuditGeneral(this.auditId)
            .then((data) => {
                this.audit = data.data.datas;
		this.auditOrig = this.$_.cloneDeep(this.audit);
            })
            .catch((err) => {              
                console.log(err.response)
            })
        },
        // Save Audit
        updateAuditNetwork: function() {
            AuditService.updateAuditNetwork(this.auditId, this.audit)
            .then(() => {
                this.auditOrig = this.$_.cloneDeep(this.audit);
                Notify.create({
                    message: $t('msg.auditUpdateOk'),
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            })
            .catch((err) => {
                Notify.create({
                    message: err.response.data.datas,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            })
        },

        // Import Network scan - Chrome workaround using Promise-based approach
        importNetworkScan: function(files, type) {
            if (!files || files.length === 0) {
                console.error('No files provided for import');
                return;
            }
            
            var file = files[0];
            if (!file) {
                console.error('Invalid file object');
                return;
            }
            
            console.log('Reading file:', file.name, 'size:', file.size, 'type:', file.type);
            console.log('File lastModified:', new Date(file.lastModified));
            
            var self = this;
            
            // Chrome workaround: Create a new File object with different MIME type
            var chromeWorkaroundFile = file;
            if (/Chrome/.test(navigator.userAgent) && file.type === 'text/xml') {
                console.log('Chrome detected with XML file, creating workaround file object');
                try {
                    // Create new File with plain text MIME type to bypass Chrome security
                    chromeWorkaroundFile = new File([file], file.name, {
                        type: 'text/plain',
                        lastModified: file.lastModified
                    });
                    console.log('Workaround file created with type:', chromeWorkaroundFile.type);
                } catch (e) {
                    console.log('File constructor failed, using original file');
                    chromeWorkaroundFile = file;
                }
            }
            
            // Try modern Promise-based approach first
            if (chromeWorkaroundFile.text && typeof chromeWorkaroundFile.text === 'function') {
                console.log('Using modern file.text() API');
                chromeWorkaroundFile.text().then(function(content) {
                    console.log('file.text() successful, size:', content.length);
                    console.log('Content preview:', content.substring(0, 100));
                    self.processFileContent(content, type);
                }).catch(function(error) {
                    console.error('file.text() failed:', error);
                    
                    // Show Chrome-specific message for nmap files
                    if (/Chrome/.test(navigator.userAgent) && type === 'nmap') {
                        Notify.create({
                            message: 'Chrome security policy blocks nmap.xml files. Please use Firefox for nmap import, or try renaming the file extension to .txt',
                            color: 'warning',
                            textColor: 'white',
                            position: 'top-right',
                            timeout: 8000
                        });
                    }
                    
                    self.fallbackFileReader(chromeWorkaroundFile, type);
                });
            } else {
                console.log('file.text() not available, using fallback');
                this.fallbackFileReader(chromeWorkaroundFile, type);
            }
        },
        
        fallbackFileReader: function(file, type) {
            console.log('Using fallback FileReader method');
            var reader = new FileReader();
            var self = this;
            
            reader.onload = function(e) {
                console.log('FileReader onload triggered');
                var result = e.target.result;
                console.log('Result type:', typeof result, 'length:', result ? result.length : 'null');
                
                if (result) {
                    console.log('Content preview:', result.substring(0, 100));
                    self.processFileContent(result, type);
                } else {
                    console.error('FileReader result is null');
                    Notify.create({
                        message: 'Cannot read file - browser compatibility issue',
                        color: 'negative',
                        textColor: 'white',
                        position: 'top-right'
                    });
                }
            };
            
            reader.onerror = function(e) {
                console.error('FileReader error details:', e);
                console.error('Error code:', e.target.error);
                Notify.create({
                    message: 'Error reading file: ' + (e.target.error ? e.target.error.message : 'Unknown error'),
                    color: 'negative',
                    textColor: 'white',
                    position: 'top-right'
                });
            };
            
            // Try readAsText without encoding first
            console.log('Attempting readAsText...');
            reader.readAsText(file);
        },

        processFileContent: function(content, type) {
            console.log('Processing file content, type:', type, 'size:', content.length);
            console.log('File content preview:', content.substring(0, 200));
            
            if (type === 'nmap') {
                this.parseXmlNmap(content);
            } else if (type === 'nessus') {
                this.parseXmlNessus(content);
            } else {
                throw new Error('Unknown scan type: ' + type);
            }
        },

        updateScopeHosts: function(scope) {
            if (!this.selectedTargets[scope.name]) {
                console.error(`Scope "${scope.name}" not found in selectedTargets.`);
                return;
            }
            for (var i=0; i<this.selectedTargets[scope.name].length; i++) {
                scope.hosts.push(this.selectedTargets[scope.name][i].host);
            }
        },

        // Method to handle host click
        onHostClick: function(host, scope) {
            // Handle different host structures
            let hostObj = host;
            if (typeof host === 'string') {
                // If host is just a string (IP), create a basic object
                hostObj = {
                    ip: host,
                    hostname: 'Unknown',
                    services: []
                };
            }
            
            this.currentHost = hostObj;
        },

        // Function for helping parsing Nmap XML
        getXmlElementByAttribute: function(elmts, attr, val) {
            for (var i=0; i<elmts.length; i++) {
                if (elmts[i].getAttribute(attr) === val) {
                    return elmts[i];
                }
            }
            return null;
        },

        // Parse imported Nmap xml
        parseXmlNmap: function(data) {
            console.log('Starting Nmap parser');
            
            if (!data || typeof data !== 'string') {
                throw new Error('Invalid data provided to parser');
            }
            
            var parser = new DOMParser();
            
            // Clean data for better Chrome compatibility
            var cleanData = data.trim();
            
            if (cleanData.length === 0) {
                throw new Error('Empty XML data');
            }
            
            // Try parsing with different MIME types for Chrome compatibility
            var xmlData;
            try {
                xmlData = parser.parseFromString(cleanData, "application/xml");
            } catch (e) {
                console.log('Failed with application/xml, trying text/xml');
                try {
                    xmlData = parser.parseFromString(cleanData, "text/xml");
                } catch (e2) {
                    console.log('Failed with text/xml, trying last fallback');
                    xmlData = parser.parseFromString(cleanData, "text/html");
                }
            }
            
            // Ensure xmlData exists
            if (!xmlData) {
                throw new Error('XML parsing completely failed');
            }
            
            // Check for XML parsing errors (Chrome compatibility)
            var parserError = xmlData.getElementsByTagName("parsererror");
            if (parserError && parserError.length > 0) {
                var errorText = parserError[0].textContent || 'Unknown parsing error';
                console.error('Parser error details:', errorText);
                throw new Error("XML Parsing Error: Invalid XML format - " + errorText);
            }
            
            // Additional Chrome-specific check
            if (!xmlData.documentElement || xmlData.documentElement.nodeName === "parsererror") {
                throw new Error("XML Parsing Error: Document could not be parsed");
            }
            
            try {
                console.log('XML document parsed successfully, root element:', xmlData.documentElement.nodeName);
                var hosts = xmlData.getElementsByTagName("host");
                console.log('Found', hosts.length, 'host elements');
                if (hosts.length === 0) throw("Parsing Error: No 'host' element found in XML");
                var hostsRes = [];
                for (var i=0; i<hosts.length; i++) {
                    var statusElements = hosts[i].getElementsByTagName("status");
                    if (statusElements.length > 0 && statusElements[0].getAttribute("state") === "up") {
                        var host = {};
                        var addrElements = hosts[i].getElementsByTagName("address");
                        if (!addrElements || addrElements.length === 0) throw("Parsing Error: No 'address' element in host number " + i);
                        host["ip"] = addrElements[0].getAttribute("addr");
    
                        var osElements = hosts[i].getElementsByTagName("os");
                        if (osElements && osElements.length > 0) {
                            var osClassElements = osElements[0].getElementsByTagName("osclass");
                            if (!osClassElements || osClassElements.length === 0) {
                                host["os"] = "";
                            }
                            else {
                                host["os"] = osClassElements[0].getAttribute("osfamily") || "";
                            }
                        } else {
                            host["os"] = "";
                        }
                        
                        var hostnamesElements = hosts[i].getElementsByTagName("hostnames");
                        if (!hostnamesElements || hostnamesElements.length === 0) {
                            host["hostname"] = "Unknown";
                        }
                        else {
                            var dnElmt = this.getXmlElementByAttribute(hostnamesElements[0].getElementsByTagName("hostname"), "type", "PTR");
                            host["hostname"] = dnElmt ? dnElmt.getAttribute("name") : "Unknown";
                        }
    
                        var portsElements = hosts[i].getElementsByTagName("ports");
                        if (!portsElements || portsElements.length === 0) throw("Parsing Error: No 'ports' element in host number " + i);
                        var ports = portsElements[0].getElementsByTagName("port");
                        host["services"] = [];
                        for (var j=0; j<ports.length; j++) {
                            var service = {};
                            service["protocol"] = ports[j].getAttribute("protocol");
                            service["port"] = ports[j].getAttribute("portid");
                            var stateElements = ports[j].getElementsByTagName("state");
                            if (stateElements && stateElements.length > 0) {
                                service["state"] = stateElements[0].getAttribute("state");
                            } else {
                                service["state"] = "unknown";
                            }
                            
                            var serviceElements = ports[j].getElementsByTagName("service");
                            if (!serviceElements || serviceElements.length === 0) {
                                service["product"]  = "Unknown";
                                service["name"]     = "Unknown";
                                service["version"]  = "Unknown";
                            } else {
                                service["product"]  = serviceElements[0].getAttribute("product")   || "Unknown";
                                service["name"]     = serviceElements[0].getAttribute("name")      || "Unknown";
                                service["version"]  = serviceElements[0].getAttribute("version")   || "Unknown";
                            }
                            console.log('Service found: ' + JSON.stringify(service));
    
                            if (service["state"] === "open") {
                                host["services"].push(service);
                            }
                        }
    
                        hostsRes.push({label: host.ip, value: host.ip, host: host});
                    }
                }
                this.targetsOptions = hostsRes;
                Notify.create({
                    message: `Successfully imported ${hostsRes.length} hosts`,
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            }
            catch (err) {
                console.log(err)
                Notify.create({
                    message: 'Error parsing Nmap: ' + err,
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            }
        },

        // Parse imported Nessus
        parseXmlNessus: function(data) {
            console.log('Starting Nessus parser');
            var parser = new DOMParser();
            var hostsRes = [];
            var xmlData = parser.parseFromString(data, "application/xml");
    
            try {
                var hosts = xmlData.getElementsByTagName("ReportHost");
                if (hosts.length == 0) throw("Parsing Error: No 'ReportHost' element");
                for (var i = 0; i < hosts.length; i++) {
                var host = {};
                var properties = hosts[i].getElementsByTagName("HostProperties")[0];
                var tags = properties.getElementsByTagName("tag");
        
                for (var j=0; j < tags.length; j++) {
                    var tag = tags[j];
                    var tag_name = tag.getAttribute("name");
                    var tag_content = tag.innerHTML;
                    if (tag_name === "host-ip") {
                    host["ip"] = tag_content;
                    }
                    if (tag_name === "operating-system") {
                    host["os"] = tag_content;
                    }
        
                    if (tag_name === "host-fqdn") {
                    host["hostname"] = tag_content;
                    }
                    if (tag_name === "netbios-name" && !host["hostname"]) {
                    host["hostname"] = tag_content;
                    }
        
                }
        
                if (!host["ip"]) {
                    host["ip"] = hosts[i].getAttribute("name") || "n/a";
                }
        
                var reports = hosts[i].getElementsByTagName("ReportItem");
                host["services"] = [];
                for (var j = 0; j < reports.length; j++) {
                    var port = reports[j].getAttribute('port');
                    var protocol = reports[j].getAttribute('protocol');
                    var svc_name = reports[j].getAttribute('svc_name');
                    var product = reports[j].getAttribute('svc_product');
                    var version = reports[j].getAttribute('svc_version');
        
                    if (port !== "0") {
                    var prev = host["services"].filter(function(service){
                        return (service.port == port);
                    });
        
                    var service = prev.length == 0 ? {} : prev[0];
        
                    service["protocol"] = protocol;
                    service["port"] = port;
                    service["name"] = svc_name || "n/a";
                    service["product"]  = product || "n/a";
                    service["version"]  = version || "n/a";
        
                    if (prev.length == 0) {
                        host["services"].push(service);
                    }
                    }
                    console.log('Service found: ' + JSON.stringify(service));
                }
                console.log(host);
                hostsRes.push({label: host.ip, value: host.ip, host: host});
                }
        
                this.targetsOptions = hostsRes;
                Notify.create({
                    message: `Successfully imported ${hostsRes.length} hosts`,
                    color: 'positive',
                    textColor:'white',
                    position: 'top-right'
                })
            }
            catch (err) {
                console.log(err)
                Notify.create({
                    message: 'Error parsing Nessus',
                    color: 'negative',
                    textColor:'white',
                    position: 'top-right'
                })
            }
        }
    }
}
