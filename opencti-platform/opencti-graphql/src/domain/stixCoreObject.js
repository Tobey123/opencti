import * as R from 'ramda';
import {
  createRelation,
  createRelations,
  deleteEntityById,
  deleteRelationsByFromAndTo,
  escapeString,
  internalLoadById,
  listEntities,
  listFromEntitiesThroughRelation,
  listToEntitiesThroughRelation,
  load,
  loadById,
  loadByIdFullyResolved,
  mergeEntitiesRaw,
  updateAttribute,
} from '../database/grakn';
import { findAll as relationFindAll } from './stixCoreRelationship';
import { notify } from '../database/redis';
import { BUS_TOPICS } from '../config/conf';
import { FunctionalError } from '../config/errors';
import { isStixCoreObject } from '../schema/stixCoreObject';
import { ABSTRACT_STIX_CORE_OBJECT, ABSTRACT_STIX_META_RELATIONSHIP, ENTITY_TYPE_IDENTITY } from '../schema/general';
import {
  isStixMetaRelationship,
  RELATION_CREATED_BY,
  RELATION_EXTERNAL_REFERENCE,
  RELATION_KILL_CHAIN_PHASE,
  RELATION_OBJECT,
  RELATION_OBJECT_LABEL,
  RELATION_OBJECT_MARKING,
} from '../schema/stixMetaRelationship';
import {
  ENTITY_TYPE_CONTAINER_NOTE,
  ENTITY_TYPE_CONTAINER_OPINION,
  ENTITY_TYPE_CONTAINER_REPORT,
} from '../schema/stixDomainObject';
import {
  ENTITY_TYPE_EXTERNAL_REFERENCE,
  ENTITY_TYPE_KILL_CHAIN_PHASE,
  ENTITY_TYPE_LABEL,
  ENTITY_TYPE_MARKING_DEFINITION,
} from '../schema/stixMetaObject';
import { isStixRelationship } from '../schema/stixRelationship';

export const findAll = async (args) => {
  let types = [];
  if (args.types && args.types.length > 0) {
    types = R.filter((type) => isStixCoreObject(type), args.types);
  }
  if (types.length === 0) {
    types.push(ABSTRACT_STIX_CORE_OBJECT);
  }
  return listEntities(types, ['standard_id'], args);
};

export const findById = async (stixCoreObjectId) => loadById(stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT);

export const createdBy = async (stixCoreObjectId) => {
  const element = await load(
    `match $to isa ${ENTITY_TYPE_IDENTITY};
    $rel(${RELATION_CREATED_BY}_from:$from, ${RELATION_CREATED_BY}_to: $to) isa ${RELATION_CREATED_BY};
    $from has internal_id "${escapeString(stixCoreObjectId)}"; get;`,
    ['to']
  );
  return element && element.to;
};

export const reports = async (stixCoreObjectId) => {
  return listFromEntitiesThroughRelation(stixCoreObjectId, null, RELATION_OBJECT, ENTITY_TYPE_CONTAINER_REPORT);
};

export const notes = (stixCoreObjectId) => {
  return listFromEntitiesThroughRelation(stixCoreObjectId, null, RELATION_OBJECT, ENTITY_TYPE_CONTAINER_NOTE);
};

export const opinions = (stixCoreObjectId) => {
  return listFromEntitiesThroughRelation(stixCoreObjectId, null, RELATION_OBJECT, ENTITY_TYPE_CONTAINER_OPINION);
};

export const labels = async (stixCoreObjectId) => {
  return listToEntitiesThroughRelation(stixCoreObjectId, null, RELATION_OBJECT_LABEL, ENTITY_TYPE_LABEL);
};

export const markingDefinitions = (stixCoreObjectId) => {
  return listToEntitiesThroughRelation(stixCoreObjectId, null, RELATION_OBJECT_MARKING, ENTITY_TYPE_MARKING_DEFINITION);
};

export const killChainPhases = (stixDomainObjectId) => {
  return listToEntitiesThroughRelation(
    stixDomainObjectId,
    null,
    RELATION_KILL_CHAIN_PHASE,
    ENTITY_TYPE_KILL_CHAIN_PHASE
  );
};

export const externalReferences = (stixDomainObjectId) => {
  return listToEntitiesThroughRelation(
    stixDomainObjectId,
    null,
    RELATION_EXTERNAL_REFERENCE,
    ENTITY_TYPE_EXTERNAL_REFERENCE
  );
};

export const stixCoreRelationships = (stixCoreObjectId, args) => {
  const finalArgs = R.assoc('fromId', stixCoreObjectId, args);
  return relationFindAll(finalArgs);
};

export const stixCoreObjectAddRelation = async (user, stixCoreObjectId, input) => {
  const data = await internalLoadById(stixCoreObjectId);
  if (!isStixCoreObject(data.entity_type) || !isStixRelationship(input.relationship_type)) {
    throw FunctionalError('Only stix-meta-relationship can be added through this method.', { stixCoreObjectId, input });
  }
  const finalInput = R.assoc('fromId', stixCoreObjectId, input);
  return createRelation(user, finalInput);
};

export const stixCoreObjectAddRelations = async (user, stixCoreObjectId, input) => {
  const stixCoreObject = await loadById(stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT);
  if (!stixCoreObject) {
    throw FunctionalError('Cannot add the relation, Stix-Core-Object cannot be found.');
  }
  if (!isStixMetaRelationship(input.relationship_type)) {
    throw FunctionalError(`Only ${ABSTRACT_STIX_META_RELATIONSHIP} can be added through this method.`);
  }
  const finalInput = R.map(
    (n) => ({ fromId: stixCoreObjectId, toId: n, relationship_type: input.relationship_type }),
    input.toIds
  );
  await createRelations(user, finalInput);
  return loadById(stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT).then((entity) =>
    notify(BUS_TOPICS[ABSTRACT_STIX_CORE_OBJECT].EDIT_TOPIC, entity, user)
  );
};

export const stixCoreObjectDeleteRelation = async (user, stixCoreObjectId, toId, relationshipType) => {
  const stixCoreObject = await loadById(stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT);
  if (!stixCoreObject) {
    throw FunctionalError('Cannot delete the relation, Stix-Core-Object cannot be found.');
  }
  if (!isStixMetaRelationship(relationshipType)) {
    throw FunctionalError(`Only ${ABSTRACT_STIX_META_RELATIONSHIP} can be deleted through this method.`);
  }
  await deleteRelationsByFromAndTo(user, stixCoreObjectId, toId, relationshipType, ABSTRACT_STIX_META_RELATIONSHIP);
  return notify(BUS_TOPICS[ABSTRACT_STIX_CORE_OBJECT].EDIT_TOPIC, stixCoreObject, user);
};

export const stixCoreObjectEditField = async (user, stixCoreObjectId, input) => {
  const stixCoreObject = await loadById(stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT);
  if (!stixCoreObject) {
    throw FunctionalError('Cannot edit the field, Stix-Core-Object cannot be found.');
  }
  const updatedStixCoreObject = await updateAttribute(user, stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT, input);
  return notify(BUS_TOPICS[ABSTRACT_STIX_CORE_OBJECT].EDIT_TOPIC, updatedStixCoreObject, user);
};

export const stixCoreObjectDelete = async (user, stixCoreObjectId) => {
  const stixCoreObject = await loadById(stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT);
  if (!stixCoreObject) {
    throw FunctionalError('Cannot delete the object, Stix-Core-Object cannot be found.');
  }
  return deleteEntityById(user, stixCoreObjectId, ABSTRACT_STIX_CORE_OBJECT);
};

export const stixCoreObjectsDelete = async (user, stixCoreObjectsIds) => {
  // Relations cannot be created in parallel.
  for (let i = 0; i < stixCoreObjectsIds.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await stixCoreObjectDelete(user, stixCoreObjectsIds[i]);
  }
  return stixCoreObjectsIds;
};

export const stixCoreObjectMerge = async (user, targetId, sourceIds) => {
  // Pre-checks
  if (R.includes(targetId, sourceIds)) {
    throw FunctionalError(`Cannot merge entities, same ID detected in source and destination`, {
      targetId,
      sourceIds,
    });
  }
  // 0. Get the object
  const targetEntity = await loadByIdFullyResolved(targetId, ABSTRACT_STIX_CORE_OBJECT);
  if (!targetEntity) {
    throw FunctionalError('Cannot merge the other objects, Stix-Object cannot be found.');
  }
  // 1. Update aliases & STIX IDs
  const sourceEntities = await Promise.all(
    sourceIds.map(async (id) => loadByIdFullyResolved(id, ABSTRACT_STIX_CORE_OBJECT))
  );
  return mergeEntitiesRaw(user, targetEntity, sourceEntities);
};
// endregion
