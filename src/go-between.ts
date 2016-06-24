import {ICollection, IRestfulConfig} from "./interfaces";

export class GoBetween
{
    private cache: Object;
    constructor(public config: IRestfulConfig){}
    
    get(className: string, params: Object): ICollection
    {
        if(!this.config.hasOwnProperty(className))
        {
            throw new Error(`${className} is not configured.`);
        }
        
        let url = this.config[className].url;
        let className = this.config[className].className;
        
        
        
    }
    
}