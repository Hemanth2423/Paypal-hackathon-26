#!/usr/bin/env python3
"""Search for cloud provider icon shape names for Draw.io diagrams.

Usage:
    python find_icon.py <search_term> [--provider aws|azure|gcp|k8s|all]

Examples:
    python find_icon.py lambda
    python find_icon.py database --provider azure
    python find_icon.py storage --provider all
"""

import sys
import argparse

# --- AWS (mxgraph.aws4.*) ---
AWS_ICONS = {
    # Compute
    "ec2": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;",
    "ec2_instance": "shape=mxgraph.aws4.instance2;",
    "lambda": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;",
    "ecs": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;",
    "eks": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eks;",
    "fargate": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.fargate;",
    "elastic_beanstalk": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elastic_beanstalk;",
    "batch": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.batch;",
    "lightsail": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lightsail;",
    # Storage
    "s3": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;",
    "s3_bucket": "shape=mxgraph.aws4.bucket;",
    "ebs": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elastic_block_store;",
    "efs": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elastic_file_system;",
    "glacier": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.glacier;",
    "fsx": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.fsx;",
    # Database
    "rds": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;",
    "aurora": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.aurora;",
    "dynamodb": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;",
    "elasticache": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elasticache;",
    "redshift": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.redshift;",
    "neptune": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.neptune;",
    "documentdb": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.documentdb;",
    "timestream": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.timestream;",
    # Networking
    "vpc": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.vpc;",
    "cloudfront": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;",
    "route_53": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.route_53;",
    "api_gateway": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;",
    "elb": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elb;",
    "alb": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.application_load_balancer;",
    "nlb": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.network_load_balancer;",
    "direct_connect": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.direct_connect;",
    "transit_gateway": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.transit_gateway;",
    "nat_gateway": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.nat_gateway;",
    "elastic_ip": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elastic_ip_address;",
    # Integration / Messaging
    "sqs": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;",
    "sns": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sns;",
    "eventbridge": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eventbridge;",
    "step_functions": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.step_functions;",
    "kinesis": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.kinesis;",
    "msk": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.managed_streaming_for_kafka;",
    "mq": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.mq;",
    # Security
    "iam": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.iam;",
    "cognito": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cognito;",
    "waf": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.waf;",
    "shield": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.shield;",
    "kms": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.key_management_service;",
    "secrets_manager": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.secrets_manager;",
    "certificate_manager": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.certificate_manager;",
    # Management
    "cloudwatch": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudwatch;",
    "cloudformation": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudformation;",
    "cloudtrail": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudtrail;",
    "systems_manager": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.systems_manager;",
    "config": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.config;",
    # Analytics
    "athena": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.athena;",
    "emr": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.emr;",
    "glue": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.glue;",
    "quicksight": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.quicksight;",
    # AI/ML
    "sagemaker": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sagemaker;",
    "bedrock": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;",
    # Containers / DevOps
    "ecr": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecr;",
    "codepipeline": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.codepipeline;",
    "codebuild": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.codebuild;",
    "codecommit": "shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.codecommit;",
    # Groups
    "group_aws_cloud": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_aws_cloud;",
    "group_region": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_region;",
    "group_vpc": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;",
    "group_subnet": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_subnet;",
    "group_availability_zone": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_availability_zone;",
    "group_security_group": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;",
    "group_auto_scaling": "shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_auto_scaling;",
    # Generic
    "users": "shape=mxgraph.aws4.users;",
    "client": "shape=mxgraph.aws4.client;",
    "internet": "shape=mxgraph.aws4.internet;",
}

# --- Azure (mxgraph.azure.*) ---
AZURE_ICONS = {
    # Compute
    "virtual_machine": "shape=mxgraph.azure.virtual_machine;",
    "vm_scale_set": "shape=mxgraph.azure.virtual_machine_scale_set;",
    "app_service": "shape=mxgraph.azure.app_service;",
    "azure_functions": "shape=mxgraph.azure.azure_functions;",
    "container_instances": "shape=mxgraph.azure.container_instances;",
    "azure_kubernetes_service": "shape=mxgraph.azure.azure_kubernetes_service;",
    "aks": "shape=mxgraph.azure.azure_kubernetes_service;",
    "batch": "shape=mxgraph.azure.batch;",
    # Storage
    "storage_blob": "shape=mxgraph.azure.storage_blob;",
    "storage_queue": "shape=mxgraph.azure.storage_queue;",
    "storage_table": "shape=mxgraph.azure.storage_table;",
    "storage_file": "shape=mxgraph.azure.storage_file;",
    "managed_disk": "shape=mxgraph.azure.managed_disk;",
    # Database
    "azure_sql_database": "shape=mxgraph.azure.azure_sql_database;",
    "sql_database": "shape=mxgraph.azure.azure_sql_database;",
    "azure_cosmos_db": "shape=mxgraph.azure.azure_cosmos_db;",
    "cosmos_db": "shape=mxgraph.azure.azure_cosmos_db;",
    "cache_redis": "shape=mxgraph.azure.cache_redis;",
    "redis": "shape=mxgraph.azure.cache_redis;",
    "postgresql": "shape=mxgraph.azure.azure_database_for_postgresql;",
    "mysql": "shape=mxgraph.azure.azure_database_for_mysql;",
    # Networking
    "virtual_network": "shape=mxgraph.azure.virtual_network;",
    "vnet": "shape=mxgraph.azure.virtual_network;",
    "load_balancer": "shape=mxgraph.azure.load_balancer;",
    "application_gateway": "shape=mxgraph.azure.application_gateway;",
    "front_door": "shape=mxgraph.azure.front_door;",
    "cdn": "shape=mxgraph.azure.cdn;",
    "dns": "shape=mxgraph.azure.dns;",
    "traffic_manager": "shape=mxgraph.azure.traffic_manager;",
    "vpn_gateway": "shape=mxgraph.azure.vpn_gateway;",
    "expressroute": "shape=mxgraph.azure.expressroute;",
    "firewall": "shape=mxgraph.azure.firewall;",
    "nsg": "shape=mxgraph.azure.network_security_group;",
    # Integration
    "api_management": "shape=mxgraph.azure.api_management;",
    "apim": "shape=mxgraph.azure.api_management;",
    "service_bus": "shape=mxgraph.azure.service_bus;",
    "event_hub": "shape=mxgraph.azure.event_hub;",
    "event_grid": "shape=mxgraph.azure.event_grid;",
    "logic_apps": "shape=mxgraph.azure.logic_apps;",
    # Security
    "key_vault": "shape=mxgraph.azure.key_vault;",
    "azure_active_directory": "shape=mxgraph.azure.azure_active_directory;",
    "aad": "shape=mxgraph.azure.azure_active_directory;",
    "entra_id": "shape=mxgraph.azure.azure_active_directory;",
    "sentinel": "shape=mxgraph.azure.sentinel;",
    # Monitoring
    "monitor": "shape=mxgraph.azure.monitor;",
    "application_insights": "shape=mxgraph.azure.application_insights;",
    "log_analytics": "shape=mxgraph.azure.log_analytics;",
    # DevOps
    "azure_devops": "shape=mxgraph.azure.azure_devops;",
    "container_registry": "shape=mxgraph.azure.container_registry;",
    "acr": "shape=mxgraph.azure.container_registry;",
    # AI
    "cognitive_services": "shape=mxgraph.azure.cognitive_services;",
    "machine_learning": "shape=mxgraph.azure.machine_learning;",
    "openai": "shape=mxgraph.azure.openai;",
}

# --- GCP (mxgraph.gcp2.*) ---
GCP_ICONS = {
    # Compute
    "compute_engine": "shape=mxgraph.gcp2.compute_engine;",
    "gce": "shape=mxgraph.gcp2.compute_engine;",
    "cloud_run": "shape=mxgraph.gcp2.cloud_run;",
    "cloud_functions": "shape=mxgraph.gcp2.cloud_functions;",
    "gke": "shape=mxgraph.gcp2.gke;",
    "app_engine": "shape=mxgraph.gcp2.app_engine;",
    # Storage
    "cloud_storage": "shape=mxgraph.gcp2.cloud_storage;",
    "gcs": "shape=mxgraph.gcp2.cloud_storage;",
    "persistent_disk": "shape=mxgraph.gcp2.persistent_disk;",
    "filestore": "shape=mxgraph.gcp2.filestore;",
    # Database
    "cloud_sql": "shape=mxgraph.gcp2.cloud_sql;",
    "cloud_spanner": "shape=mxgraph.gcp2.cloud_spanner;",
    "cloud_firestore": "shape=mxgraph.gcp2.cloud_firestore;",
    "firestore": "shape=mxgraph.gcp2.cloud_firestore;",
    "bigtable": "shape=mxgraph.gcp2.bigtable;",
    "memorystore": "shape=mxgraph.gcp2.memorystore;",
    "bigquery": "shape=mxgraph.gcp2.bigquery;",
    # Networking
    "cloud_load_balancing": "shape=mxgraph.gcp2.cloud_load_balancing;",
    "cloud_cdn": "shape=mxgraph.gcp2.cloud_cdn;",
    "cloud_dns": "shape=mxgraph.gcp2.cloud_dns;",
    "cloud_armor": "shape=mxgraph.gcp2.cloud_armor;",
    "vpc_network": "shape=mxgraph.gcp2.vpc_network;",
    "cloud_nat": "shape=mxgraph.gcp2.cloud_nat;",
    "cloud_interconnect": "shape=mxgraph.gcp2.cloud_interconnect;",
    # Integration
    "pub_sub": "shape=mxgraph.gcp2.pub_sub;",
    "pubsub": "shape=mxgraph.gcp2.pub_sub;",
    "cloud_tasks": "shape=mxgraph.gcp2.cloud_tasks;",
    "cloud_scheduler": "shape=mxgraph.gcp2.cloud_scheduler;",
    "workflows": "shape=mxgraph.gcp2.workflows;",
    "api_gateway": "shape=mxgraph.gcp2.api_gateway;",
    "apigee": "shape=mxgraph.gcp2.apigee;",
    # Security
    "cloud_iam": "shape=mxgraph.gcp2.cloud_iam;",
    "secret_manager": "shape=mxgraph.gcp2.secret_manager;",
    "kms": "shape=mxgraph.gcp2.cloud_kms;",
    # Monitoring
    "cloud_monitoring": "shape=mxgraph.gcp2.cloud_monitoring;",
    "cloud_logging": "shape=mxgraph.gcp2.cloud_logging;",
    "cloud_trace": "shape=mxgraph.gcp2.cloud_trace;",
    # AI
    "vertex_ai": "shape=mxgraph.gcp2.vertex_ai;",
    "cloud_vision": "shape=mxgraph.gcp2.cloud_vision;",
    # DevOps
    "cloud_build": "shape=mxgraph.gcp2.cloud_build;",
    "artifact_registry": "shape=mxgraph.gcp2.artifact_registry;",
    "cloud_deploy": "shape=mxgraph.gcp2.cloud_deploy;",
    # Data
    "dataflow": "shape=mxgraph.gcp2.dataflow;",
    "dataproc": "shape=mxgraph.gcp2.dataproc;",
    "composer": "shape=mxgraph.gcp2.composer;",
}

# --- Kubernetes (mxgraph.kubernetes.*) ---
K8S_ICONS = {
    "pod": "shape=mxgraph.kubernetes.pod;",
    "service": "shape=mxgraph.kubernetes.service;",
    "deployment": "shape=mxgraph.kubernetes.deployment;",
    "stateful_set": "shape=mxgraph.kubernetes.stateful_set;",
    "daemon_set": "shape=mxgraph.kubernetes.daemon_set;",
    "replica_set": "shape=mxgraph.kubernetes.replica_set;",
    "job": "shape=mxgraph.kubernetes.job;",
    "cronjob": "shape=mxgraph.kubernetes.cronjob;",
    "node": "shape=mxgraph.kubernetes.node;",
    "namespace": "shape=mxgraph.kubernetes.namespace;",
    "ingress": "shape=mxgraph.kubernetes.ingress;",
    "configmap": "shape=mxgraph.kubernetes.configmap;",
    "secret": "shape=mxgraph.kubernetes.secret;",
    "persistent_volume": "shape=mxgraph.kubernetes.persistent_volume;",
    "persistent_volume_claim": "shape=mxgraph.kubernetes.persistent_volume_claim;",
    "pvc": "shape=mxgraph.kubernetes.persistent_volume_claim;",
    "storage_class": "shape=mxgraph.kubernetes.storage_class;",
    "hpa": "shape=mxgraph.kubernetes.hpa;",
    "network_policy": "shape=mxgraph.kubernetes.network_policy;",
    "service_account": "shape=mxgraph.kubernetes.service_account;",
    "role": "shape=mxgraph.kubernetes.role;",
    "cluster_role": "shape=mxgraph.kubernetes.cluster_role;",
}

PROVIDERS = {
    "aws": ("AWS", AWS_ICONS),
    "azure": ("Azure", AZURE_ICONS),
    "gcp": ("GCP", GCP_ICONS),
    "k8s": ("Kubernetes", K8S_ICONS),
}

ICON_STYLE_SUFFIX = "labelBackgroundColor=none;sketch=0;fontColor=#232F3E;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;align=center;"


def search(term: str, provider: str = "all") -> list[dict]:
    term_lower = term.lower().replace("-", "_").replace(" ", "_")
    results = []

    sources = PROVIDERS.items() if provider == "all" else [(provider, PROVIDERS[provider])]

    for key, (name, icons) in sources:
        for icon_name, style in icons.items():
            if term_lower in icon_name or icon_name in term_lower:
                results.append({
                    "provider": name,
                    "name": icon_name,
                    "style": style + ICON_STYLE_SUFFIX,
                })

    return results


def main():
    parser = argparse.ArgumentParser(description="Search for Draw.io cloud provider icon shapes")
    parser.add_argument("term", help="Search term (e.g., 'lambda', 'database', 'load_balancer')")
    parser.add_argument("--provider", choices=["aws", "azure", "gcp", "k8s", "all"], default="all",
                        help="Filter by cloud provider (default: all)")
    args = parser.parse_args()

    results = search(args.term, args.provider)

    if not results:
        print(f"No icons found for '{args.term}'")
        print(f"Tip: Try a shorter term or check spelling. Use underscores for multi-word names.")
        sys.exit(1)

    print(f"\nFound {len(results)} icon(s) for '{args.term}':\n")
    for r in results:
        print(f"  [{r['provider']}] {r['name']}")
        print(f"    style=\"{r['style']}\"")
        print()


if __name__ == "__main__":
    main()
