/**
 * Alerts Service — Business Logic Layer
 */

import { FastifyInstance } from 'fastify';
import { AlertsRepository } from './alerts.repository';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ResponderRepository } from '../responder/responder.repository';
import { ForbiddenError } from '@/utils/errors';
import { EmergencyAlert } from '@prisma/client';
import { generateTrackingToken } from './alerts.tokens';

import { CasesService } from '../cases/cases.service';

export class AlertsService {
  constructor(
    private readonly repo: AlertsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly responderRepo: ResponderRepository,
    private readonly casesService: CasesService,
    private readonly fastify: FastifyInstance,
  ) {}

  async triggerManualSos(
    userId: string,
    data: { latitude: number; longitude: number; accuracy?: number },
    ipAddress?: string,
  ): Promise<EmergencyAlert & { trackingToken?: string; contactPhones?: string[] }> {
    // 1. Verify user has at least one trusted contact
    const contacts = await this.contactsRepo.getContactsByUserId(userId);
    if (contacts.length === 0) {
      this.fastify.log.warn('User has no trusted contacts, but allowing SOS for police dispatch.');
    }

    // 2. Find nearest police station using PostGIS
    const nearestStation = await this.repo.findNearestPoliceStation(data.latitude, data.longitude);

    // 3. Save the alert
    const alert = await this.repo.createAlert({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      assignedStationId: nearestStation?.id || null,
      status: 'confirmed',
    });

    await this.dispatchConfirmedAlert(alert, data, ipAddress, nearestStation);

    const trackingToken = generateTrackingToken(alert.id);
    const contactPhones = contacts.map(c => c.phone);

    return { ...alert, trackingToken, contactPhones };
  }

  private async dispatchConfirmedAlert(
    alert: EmergencyAlert,
    data: { latitude: number; longitude: number; accuracy?: number },
    ipAddress?: string,
    nearestStation?: any
  ) {
    // 4. Save audit log
    await this.repo.createAuditLog({
      userId: alert.userId,
      action: 'sos_triggered',
      entityType: 'alert',
      entityId: alert.id,
      metadata: {
        alertType: alert.type,
        status: 'confirmed',
        nearestStationId: nearestStation?.id,
      },
      ipAddress,
    });

    // 5. Enqueue notification jobs for trusted contacts
    if (this.fastify.queues?.notifications) {
      // The worker will find the trusted contacts and send SMS/Push
      await this.fastify.queues.notifications.add('notify_trusted_contacts', {
        alertId: alert.id,
        userId: alert.userId,
      });
    } else {
      this.fastify.log.warn('Notifications queue is not initialized. Skipping trusted contact notifications.');
    }

    // 6. Notify police portal via WebSocket
    if (this.fastify.io) {
      const eventPayload = {
        alertId: alert.id,
        userId: alert.userId,
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: new Date().toISOString(),
      };

      // Notify the specific station if matched, and ALWAYS notify general police dispatch (for Admin/Global)
      if (nearestStation) {
        this.fastify.io.to(`station:${nearestStation.id}`).emit('alert:created', eventPayload);
      }
      this.fastify.io.to('station:dispatch').emit('alert:created', eventPayload);
    } else {
      this.fastify.log.warn('WebSocket is not initialized. Skipping police portal notification.');
    }

    // 6.5. Auto-create police case if station is matched
    if (nearestStation) {
      try {
        await this.casesService.createCaseFromAlert(alert.id, nearestStation.id);
      } catch (err) {
        this.fastify.log.error(err, 'Failed to auto-create case for alert');
      }
    }
  
    // 7. Dispatch to nearby responders (within 5km)
    try {
      const radiusMeters = 5000;
      const nearbyResponders = await this.responderRepo.findNearbyResponders(data.latitude, data.longitude, radiusMeters);
      
      for (const responder of nearbyResponders) {
        // Create dispatch record
        const dispatch = await this.responderRepo.createDispatch(responder.id, alert.id);
        const dispatchPayload = {
          dispatchId: dispatch.id,
          alertId: alert.id,
          latitude: Math.round(data.latitude * 100) / 100, // Masked location
          longitude: Math.round(data.longitude * 100) / 100,
          timestamp: new Date().toISOString(),
          screen: 'ResponderHub'
        };

        // Notify responder via websocket
        if (this.fastify.io) {
          this.fastify.io.to(`user:${responder.userId}`).emit('responder:dispatch_received', dispatchPayload);
        }

        // Notify responder via Expo Push Notifications
        try {
          const deviceTokens = await this.fastify.prisma.deviceToken.findMany({
            where: { userId: responder.userId, isActive: true }
          });
          
          if (deviceTokens.length > 0) {
            const messages = deviceTokens.map(dt => ({
              to: dt.token,
              sound: 'default',
              title: '🚨 EMERGENCY DISPATCH',
              body: 'A citizen nearby has triggered an SOS! Tap to respond.',
              data: dispatchPayload,
            }));

            // Use Expo Push API
            fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(messages),
            }).catch(err => this.fastify.log.error('Error sending Expo push', err));
          }
        } catch (pushErr) {
          this.fastify.log.error(pushErr, 'Failed to query device tokens or send push');
        }
      }
    } catch (err) {
      this.fastify.log.error(err, 'Failed to dispatch to nearby responders');
    }
  }

  async createSoftAlert(
    userId: string,
    data: { latitude: number; longitude: number; accuracy?: number; mlMetadata?: any }
  ): Promise<EmergencyAlert> {
    // We do NOT verify trusted contacts here because it's a passive sensor event.
    // If they have no contacts, it just won't notify anyone later, but we still record the event.

    const nearestStation = await this.repo.findNearestPoliceStation(data.latitude, data.longitude);

    const alert = await this.repo.createAlert({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      assignedStationId: nearestStation?.id || null,
      type: 'sensor_triggered',
      status: 'created',
      isSoftAlert: true,
      softAlertAt: new Date(),
      mlMetadata: data.mlMetadata || null,
    });

    // Enqueue an escalation job that will automatically confirm the alert in 30 seconds
    if (this.fastify.queues?.escalations) {
      await this.fastify.queues.escalations.add(
        'auto_escalate_soft_alert',
        { alertId: alert.id, userId },
        { delay: 30000 } // 30 seconds delay
      );
      this.fastify.log.info({ alertId: alert.id }, 'Scheduled auto-escalation for soft alert');
    }

    return alert;
  }

  async cancelSoftAlert(userId: string, alertId: string): Promise<void> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    if (alert.status !== 'created') {
      throw new ForbiddenError('Cannot cancel an alert that is not in soft-alert state');
    }

    await this.repo.updateAlert(alertId, {
      status: 'false_alarm',
      softAlertCancelledAt: new Date(),
      closedAt: new Date(),
    });
  }

  async confirmSoftAlert(userId: string, alertId: string): Promise<EmergencyAlert & { trackingToken?: string; contactPhones?: string[] }> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    if (alert.status !== 'created') {
      throw new ForbiddenError('Cannot confirm an alert that is not in soft-alert state');
    }

    // 1. Verify user has at least one trusted contact (same rule as manual SOS)
    const contacts = await this.contactsRepo.getContactsByUserId(userId);
    if (contacts.length === 0) {
      this.fastify.log.warn('User has no trusted contacts, but allowing soft alert confirmation.');
    }

    // Update state to confirmed
    const updatedAlert = await this.repo.updateAlert(alertId, {
      status: 'confirmed',
      confirmedAt: new Date(),
    });

    const nearestStation = updatedAlert.assignedStationId 
      ? { id: updatedAlert.assignedStationId } 
      : undefined;

    await this.dispatchConfirmedAlert(updatedAlert, {
      latitude: Number(updatedAlert.latitude),
      longitude: Number(updatedAlert.longitude),
      accuracy: updatedAlert.accuracy ? Number(updatedAlert.accuracy) : undefined
    }, undefined, nearestStation);

    const trackingToken = generateTrackingToken(updatedAlert.id);
    const contactPhones = contacts.map(c => c.phone);

    return { ...updatedAlert, trackingToken, contactPhones };
  }

  async cancelSosAlert(userId: string, alertId: string): Promise<void> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    const closedStatuses = ['closed', 'cancelled', 'false_alarm', 'resolved'];
    if (closedStatuses.includes(alert.status)) {
      return;
    }

    await this.repo.updateAlert(alertId, {
      status: 'false_alarm',
      closedAt: new Date(),
    });

    if (this.fastify.io) {
      const eventPayload = { alertId, status: 'false_alarm' };
      if (alert.assignedStationId) {
        this.fastify.io.to(`station:${alert.assignedStationId}`).emit('alert_status_update', eventPayload);
      }
      this.fastify.io.to('station:dispatch').emit('alert_status_update', eventPayload);
    }
  }
  
    async updateLocation(
      userId: string,
      alertId: string,
      data: { latitude: number; longitude: number; accuracy?: number }
    ): Promise<void> {
      const alert = await this.repo.getAlertById(alertId);
  
      if (!alert) {
        throw new ForbiddenError('Alert not found');
      }
  
      if (alert.userId !== userId) {
        throw new ForbiddenError('You can only update locations for your own alerts');
      }
  
      const closedStatuses = ['closed', 'cancelled', 'false_alarm', 'resolved'];
      if (closedStatuses.includes(alert.status)) {
        throw new ForbiddenError('Cannot update location for a closed alert');
      }
  
      await this.repo.addLocationUpdate(alertId, data.latitude, data.longitude, data.accuracy);
  
      if (this.fastify.io) {
        const eventPayload = {
          alertId,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: new Date().toISOString(),
        };
  
        if (alert.assignedStationId) {
          this.fastify.io.to(`station:${alert.assignedStationId}`).emit('alert:location_update', eventPayload);
        }
        // Always send to dispatch for global admin tracking
        this.fastify.io.to('station:dispatch').emit('alert:location_update', eventPayload);
      }
    }
  
    generateTrackingToken(_userId: string, alertId: string, trustedContactId?: string): { token: string, expiresAt: Date } {
      const token = generateTrackingToken(alertId, trustedContactId);
      
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      return { token, expiresAt };
    }

    async processSmsWebhook(from: string, body: string): Promise<void> {
      // Clean up the phone number (Twilio sends +1234567890)
      const phone = from.trim();
      const user = await this.repo.findUserByPhone(phone);
      
      if (!user) {
        this.fastify.log.warn(`Received SMS from unregistered number: ${phone}`);
        return;
      }

      // Look for Google Maps link: https://maps.google.com/?q=23.79,90.41
      const match = body.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      
      if (match && match.length === 3) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);

        if (!isNaN(lat) && !isNaN(lng)) {
          this.fastify.log.info(`Processing Offline SMS SOS for user ${user.id} at ${lat}, ${lng}`);
          await this.triggerManualSos(user.id, { latitude: lat, longitude: lng });
        } else {
          this.fastify.log.warn(`Invalid coordinates in SMS from ${phone}: ${body}`);
        }
      } else {
        // Fallback to strict format: SOS <lat> <lng>
        const parts = body.trim().split(/\s+/);
        if (parts.length >= 3 && parts[0].toUpperCase() === 'SOS') {
          const lat = parseFloat(parts[1]);
          const lng = parseFloat(parts[2]);
  
          if (!isNaN(lat) && !isNaN(lng)) {
            this.fastify.log.info(`Processing Strict Offline SMS SOS for user ${user.id} at ${lat}, ${lng}`);
            await this.triggerManualSos(user.id, { latitude: lat, longitude: lng });
          } else {
            this.fastify.log.warn(`Invalid fallback coordinates in SMS from ${phone}: ${body}`);
          }
        } else {
          this.fastify.log.warn(`Unrecognized SMS format from ${phone}: ${body}`);
        }
      }
    }

    async getSafeRoute(userId: string, origin: any, destination: any) {
      try {
        const response = await fetch(`${process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000/api/v1'}/safe-route`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Authenticate to the ML service with the shared secret.
            ...(process.env.ML_SERVICE_API_KEY ? { 'X-API-Key': process.env.ML_SERVICE_API_KEY } : {}),
          },
          body: JSON.stringify({ origin, destination })
        });
        const mlData = (await response.json()) as any;
        const waypoints = mlData.data.waypoints;

        const route = await this.fastify.prisma.activeRoute.create({
          data: {
            userId,
            originLat: origin.lat,
            originLng: origin.lng,
            destLat: destination.lat,
            destLng: destination.lng,
            waypoints
          }
        });

        return route;
      } catch (err) {
        this.fastify.log.error(err, 'Failed to get safe route from ML service');
        throw new Error('Could not calculate safe route');
      }
    }

    async updateRouteLocation(userId: string, routeId: string, latitude: number, longitude: number) {
      const route = await this.fastify.prisma.activeRoute.findUnique({ where: { id: routeId } });
      if (!route || route.userId !== userId) throw new ForbiddenError('Route not found');

      // Check deviation (simplified: >500m from closest waypoint)
      // In a real app we'd use Turf.js or PostGIS ST_Distance. Here we use a naive approx for MVP
      const waypoints = route.waypoints as any[];
      let minDistanceSq = Infinity;
      for (const wp of waypoints) {
        const dLat = (wp.lat - latitude) * 111000; // approx meters
        const dLng = (wp.lng - longitude) * 111000 * Math.cos(latitude * Math.PI / 180);
        const distSq = dLat*dLat + dLng*dLng;
        if (distSq < minDistanceSq) minDistanceSq = distSq;
      }

      const isDeviated = minDistanceSq > 250000; // 500^2

      if (isDeviated) {
        await this.fastify.prisma.activeRoute.update({
          where: { id: routeId },
          data: { status: 'deviated' }
        });
        
        // Trigger soft alert
        await this.createSoftAlert(userId, { latitude, longitude, mlMetadata: { reason: 'Route deviation > 500m' } });
      }

      return { deviated: isDeviated };
    }
  }
