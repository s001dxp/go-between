export interface ICollection {}

export interface IVerbUrl
{
    get?: string,
    post?: string,
    'delete'?: string,
    put?: string,
    patch?: string
}

export interface IAPIMap
{
    className: string,
    url: string | IVerbUrl
}

export interface IRestfulConfig
{
    [name: string]: IAPIMap
}