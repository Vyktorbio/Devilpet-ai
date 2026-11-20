//! Local HTTP adapter: renderer-independent living connectome experiment.
//! Only runs when actual CSR files and source-backed reviewed ports are supplied.
//! Not an HTTPS public server; bind loopback and use a secure reverse proxy
//! for remote experiments. Never claim this unsigned propagation is physiology.
use devilpet_connectome::{Graph,PropagationConfig,ports::{ConnectomeController,Ports}};
use serde::{Deserialize,Serialize};
use std::{collections::BTreeMap,env,error::Error,fs,io::{self,Read},path::PathBuf};
use tiny_http::{Header,Method,Response,Server,StatusCode};

#[derive(Deserialize)]
struct Observation {
    channels:BTreeMap<String,f32>,
    #[serde(default="default_hops")]hops:usize,
    #[serde(default)]sample_id:u64,
}
fn default_hops()->usize{3}
#[derive(Serialize)]
struct ErrorMessage<'a> {
    error:&'a str,reason:String,
}
fn respond(request:tiny_http::Request,origin:Option<&str>,body:String,status:u16){
    let mut resp=Response::from_string(body).with_status_code(StatusCode(status));
    let mut headers=vec![
        ("Content-Type","application/json; charset=utf-8"),
        ("Cache-Control","no-store"),
        ("X-Content-Type-Options","nosniff"),
        ("Access-Control-Allow-Methods","GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers","Content-Type"),
        ("Access-Control-Max-Age","600"),
    ];
    if let Some(origin)=origin{headers.push(("Access-Control-Allow-Origin",origin));}
    for (key,value) in headers{
        if let Ok(h)=Header::from_bytes(key.as_bytes(),value.as_bytes()){resp.add_header(h);}
    }
    if let Err(e)=request.respond(resp){eprintln!("response failed: {e}");}
}
fn error(request:tiny_http::Request,origin:Option<&str>,why:&str,status:u16){
    let payload=serde_json::to_string(&ErrorMessage{error:"invalid_request",reason:why.to_string()})
        .unwrap_or_else(|_|"{}".into());
    respond(request,origin,payload,status);
}
fn is_permitted_origin(origin:&str)->bool{
    origin=="https://vyktorbio.github.io" ||
      origin=="http://127.0.0.1:8137" ||
      origin=="http://localhost:8137"
}
fn usage()->&'static str{
    "Usage: cargo run --release --bin connectome-serve -- \\
      --graph data/compiled/male-cns-v1.0 \\
      --ports data/ports-reviewed.json [--bind 127.0.0.1:8326]"
}
fn main()->Result<(),Box<dyn Error+Send+Sync>>{
    let args:Vec<String>=env::args().collect();
    let mut graph_path=None;
    let mut ports_path=None;
    let mut bind="127.0.0.1:8326".to_string();
    let mut i=1;
    while i<args.len(){
        let item=args[i].as_str();
        if !["--graph","--ports","--bind"].contains(&item){return Err(format!("Unknown option: {item}; {}",usage()).into());}
        let value=args.get(i+1).ok_or_else(||format!("Missing value for {item}"))?;
        match item{
            "--graph"=>graph_path=Some(PathBuf::from(value)),
            "--ports"=>ports_path=Some(PathBuf::from(value)),
            "--bind"=>bind=value.clone(),
            _=>unreachable!()
        }
        i+=2;
    }
    let graph_path=graph_path.ok_or(usage())?;
    let ports_path=ports_path.ok_or(usage())?;
    if !(bind.starts_with("127.0.0.1:")||bind.starts_with("localhost:")){
        return Err("Server is restricted to loopback for safety. Use a reverse proxy for remote access.".into());
    }
    let graph=Graph::open(graph_path)?;
    let ports=Ports::read(ports_path)?;
    let cfg=PropagationConfig::default();
    let controller=ConnectomeController::new(&graph,ports,cfg)?;
    let server=Server::http(&bind)?;
    let dataset=&graph.manifest;
    println!("DevilPet CNS sensor/motor bridge listening on {bind}");
    println!("Connected ONLY to local dataset {} {}, {} vertices and {} edge records",
        dataset.dataset_id,dataset.version,dataset.node_count,dataset.edge_count);
    println!("This is experimental unsigned graph propagation; NOT a validated neuronal physiology.");
    let health=serde_json::json!({
      "schema":"devilpet-cns-server-v1",
      "status":"graph_loaded_ports_reviewed",
      "dataset_id":dataset.dataset_id,
      "dataset_version":dataset.version,
      "dataset_source":dataset.source,
      "license":dataset.license,
      "node_count":dataset.node_count,
      "edge_count":dataset.edge_count,
      "port_map_reviewed_by":controller.ports.reviewed_by,
      "available_sensors":controller.ports.sensors.keys().cloned().collect::<Vec<_>>(),
      "available_motors":controller.ports.motors.keys().cloned().collect::<Vec<_>>(),
      "controller_semantics":"unsigned-anatomical-experimental-not-validated-physiology",
      "full_cns_assigned":false
    }).to_string();
    for mut request in server.incoming_requests(){
        let origin_header=request.headers().iter()
            .find(|h|h.field.equiv("Origin")).map(|h|h.value.as_str().to_string());
        if origin_header.as_deref().is_some_and(|o|!is_permitted_origin(o)){
            error(request,None,"origin not allowed",403);
            continue;
        }
        let origin=origin_header.as_deref();
        if request.method()==&Method::Options{
            respond(request,origin,"{}".into(),204);continue;
        }
        let url=request.url().split('?').next().unwrap_or("");
        match (request.method(),url){
            (&Method::Get,"/health")=>respond(request,origin,health.clone(),200),
            (&Method::Post,"/step")=>{
                let header_len=request.headers().iter()
                    .find(|h|h.field.equiv("Content-Length"))
                    .and_then(|h|h.value.as_str().parse::<usize>().ok());
                if header_len.is_some_and(|n|n>16_384){
                    error(request,origin,"JSON body too large",413);continue;
                }
                let mut bytes=Vec::new();
                if request.as_reader().take(16_385).read_to_end(&mut bytes).is_err()||bytes.len()>16_384{
                    error(request,origin,"request body too large",413);continue;
                }
                let observation:Observation=match serde_json::from_slice(&bytes){
                    Ok(v)=>v,
                    Err(_)=>{error(request,origin,"malformed sensor frame",400);continue;}
                };
                match controller.step(&observation.channels,observation.hops){
                    Ok(motor)=>{
                        let response=serde_json::json!({
                          "schema":"devilpet-cns-output-v1",
                          "sample_id":observation.sample_id,
                          "dataset_id":dataset.dataset_id,
                          "dataset_version":dataset.version,
                          "motor":motor,
                          "controller_semantics":"experimental-anatomical-unsigned"
                        });
                        respond(request,origin,response.to_string(),200);
                    },
                    Err(err)=>error(request,origin,&err.to_string(),422)
                }
            },
            _=>error(request,origin,"unknown route",404)
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn origin_policy(){
        assert!(is_permitted_origin("https://vyktorbio.github.io"));
        assert!(!is_permitted_origin("https://evil.example"));
        assert!(!is_permitted_origin("null"));
    }
}
