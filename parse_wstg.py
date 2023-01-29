import pandas
import json
import markdown




def main(file, sheet_name, locale, vuln_type):

    # ===============
    # Read Excel
    # ===============

    excel_data_df = pandas.read_excel(file, sheet_name)
    thisisjson = excel_data_df.to_json(orient='records')
    thisisjson_dict = json.loads(thisisjson)


    # ===============
    # Parsing
    # ===============

    final_json = []

    for i in range(len(excel_data_df.index)): 
        line = thisisjson_dict[i]

        dict_to_write={}
        details = []
        details_dict = {}


        references = []

        

        tmp = line.get('References').strip().split('\n')
        for j in range(len(tmp)):

            references.append(tmp[j].replace('- https', 'https').strip())
            
        details_dict['references']= references
        
        
        '''
        # If you want to populate vulns with existing custom field, you have first to export a sample vuln with created custom field and obtain its reference.
        # See Custom Fields in documentation
        
        custom_fields_dict = {
            "customField": "63d264980841f2001194541c",
            "text": "N/A"
        }
        custom_fields=[custom_fields_dict]
        details_dict['customFields']= custom_fields
        '''

        details_dict['locale']= locale
        details_dict['title']= line.get('Title')
        details_dict['vulnType']= vuln_type

        
        details_dict['description'] = markdown.markdown(line.get('Description').strip())
        details_dict['observation']=  markdown.markdown(line.get('Impact').strip())
        details_dict['remediation']=  markdown.markdown(line.get('Remediation').strip())
        

        dict_to_write={}

        dict_to_write['cvssv3']= line.get('Recommended CVSSv3')
        dict_to_write['category']= line.get('Category')
        details=[details_dict]
        dict_to_write['details']= details
        
        final_json.append(dict_to_write)

    


    # ===============
    # Writing to Excel
    # ===============
    filename_to_write = file.replace('.xlsx','').replace('.xls','')+"_"+locale+'.json'
    with open(filename_to_write, 'w', encoding='utf8') as json_file:
        json.dump(final_json, json_file,  indent = 4, ensure_ascii = False)



    # ===============
    # Replacing
    # ===============

    # read produced file
    with open(filename_to_write, 'r', encoding='utf8') as file :
        filedata = file.read()
        filedata = filedata.replace('<li>', '<li><p>')
        filedata = filedata.replace('</li>', '</p></li>')
        filedata = filedata.replace(r'\n', '')

    # Write the file out again
    with open(filename_to_write, 'w', encoding='utf8') as file:
        file.write(filedata)
    


if __name__ == '__main__':
    
    #def main(file, sheet_name, locale, vuln_type):

    main("OWASP_WSTG_ASVS.xlsx", "vulns_ESP", "es", "OWASP WSTG")
    main("OWASP_WSTG_ASVS.xlsx", "vulns_ENG", "en", "OWASP WSTG")
    
    